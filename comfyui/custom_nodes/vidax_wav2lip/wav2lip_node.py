import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch


TARGET_SAMPLE_RATE = 16000


def _warn(message):
    # ComfyUI logs stdout; keep warnings compact.
    print(f'[VIDAX_Wav2Lip] {message}')


def _normalize_mode(mode):
    return 'repetitive' if mode == 'repetitive' else 'sequential'


def images_to_uint8_list(images):
    if isinstance(images, torch.Tensor):
        tensor = images.detach().float().cpu()
        if tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)
        arr = (tensor.numpy() * 255.0).clip(0, 255).astype(np.uint8)
        return [np.ascontiguousarray(arr[i]) for i in range(arr.shape[0])]
    if isinstance(images, np.ndarray):
        array = images
        if array.ndim == 3:
            array = array[None, ...]
        if array.dtype != np.uint8:
            array = (array.astype(np.float32) * 255.0).clip(0, 255).astype(np.uint8)
        return [np.ascontiguousarray(array[i]) for i in range(array.shape[0])]
    if isinstance(images, (list, tuple)):
        converted = []
        for item in images:
            if isinstance(item, torch.Tensor):
                converted.append(np.ascontiguousarray((item.detach().float().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)))
            else:
                np_item = np.asarray(item)
                if np_item.dtype != np.uint8:
                    np_item = (np_item.astype(np.float32) * 255.0).clip(0, 255).astype(np.uint8)
                converted.append(np.ascontiguousarray(np_item))
        return converted
    raise TypeError(f'Unsupported IMAGE type: {type(images)}')


def uint8_list_to_images(frames_uint8):
    if isinstance(frames_uint8, torch.Tensor):
        tensor = frames_uint8
        if tensor.dtype != torch.float32:
            tensor = tensor.float()
        if tensor.ndim == 4 and tensor.shape[1] in (1, 3) and tensor.shape[-1] not in (1, 3):
            tensor = tensor.permute(0, 2, 3, 1)
        return tensor.clamp(0, 1)
    if isinstance(frames_uint8, np.ndarray):
        array = frames_uint8
        if array.ndim == 3:
            array = array[None, ...]
        return torch.from_numpy(array.astype(np.float32) / 255.0)
    if isinstance(frames_uint8, (list, tuple)):
        if len(frames_uint8) == 0:
            return torch.empty((0,))
        return torch.from_numpy(np.stack([np.asarray(frame, dtype=np.uint8) for frame in frames_uint8], axis=0).astype(np.float32) / 255.0)
    raise TypeError(f'Unsupported frames type: {type(frames_uint8)}')


class VIDAX_Wav2Lip:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'images': ('IMAGE',),
                'audio': ('AUDIO',),
                'mode': (['sequential', 'repetitive'], {'default': 'sequential'}),
                'face_detect_batch': ('INT', {'default': 8, 'min': 1, 'max': 64, 'step': 1}),
                'on_no_face': (['passthrough', 'error'], {'default': 'passthrough'}),
            }
        }

    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'VIDAX/LipSync'

    def __init__(self):
        self._cached_module = None
        self._import_attempted = False

    def _resolve_paths(self):
        custom_nodes_dir = Path(__file__).resolve().parents[1]
        model_path = custom_nodes_dir / 'ComfyUI_wav2lip' / 'Wav2Lip' / 'checkpoints' / 'wav2lip_gan.pth'
        return custom_nodes_dir, model_path

    def _load_wav2lip_module(self):
        if self._cached_module is not None or self._import_attempted:
            return self._cached_module

        self._import_attempted = True
        custom_nodes_dir, _ = self._resolve_paths()
        paths = [
            custom_nodes_dir / 'ComfyUI_wav2lip',
            custom_nodes_dir / 'ComfyUI_wav2lip' / 'Wav2Lip',
            custom_nodes_dir / 'ComfyUI_wav2lip' / 'wav2lip',
        ]
        for path in paths:
            str_path = str(path)
            if str_path not in sys.path:
                sys.path.append(str_path)

        try:
            from Wav2Lip.wav2lip_node import wav2lip_  # type: ignore
        except Exception as exc:
            _warn(f'Failed to import ComfyUI_wav2lip: {exc}')
            self._cached_module = None
            return None

        self._cached_module = wav2lip_
        return self._cached_module

    def _to_mono_waveform(self, audio):
        sample_rate = None
        waveform = None
        if isinstance(audio, dict):
            sample_rate = audio.get('sample_rate') or audio.get('sampleRate')
            waveform = audio.get('waveform') if 'waveform' in audio else audio.get('audio')
        elif isinstance(audio, (list, tuple)):
            if len(audio) >= 2 and isinstance(audio[0], (int, float)) and audio[0] > 0:
                sample_rate = int(audio[0])
                waveform = audio[1]
            elif len(audio) >= 2 and isinstance(audio[1], (int, float)) and audio[1] > 0:
                sample_rate = int(audio[1])
                waveform = audio[0]
            elif len(audio):
                waveform = audio[0]
        else:
            waveform = audio

        if waveform is None:
            raise RuntimeError('No audio provided to VIDAX_Wav2Lip')

        if isinstance(waveform, torch.Tensor):
            tensor = waveform.detach()
        else:
            tensor = torch.tensor(np.array(waveform), dtype=torch.float32)

        tensor = tensor.squeeze()
        if tensor.dim() > 1:
            tensor = tensor.mean(dim=0)

        if not sample_rate or sample_rate <= 0:
            sample_rate = TARGET_SAMPLE_RATE
        np_audio = tensor.cpu().float().numpy().astype(np.float32)
        return sample_rate, np_audio

    def _resample_to_target(self, audio, sample_rate):
        if sample_rate == TARGET_SAMPLE_RATE or audio.size == 0:
            return audio.astype(np.float32)
        ratio = TARGET_SAMPLE_RATE / float(sample_rate)
        if len(audio) < 2:
            return audio.astype(np.float32)
        positions = np.arange(len(audio), dtype=np.float32)
        target_positions = np.linspace(0, positions[-1], int(np.ceil(len(audio) * ratio)), dtype=np.float32)
        return np.interp(target_positions, positions, audio).astype(np.float32)

    def _write_temp_wav(self, audio):
        array16k = self._resample_to_target(audio[1], audio[0])
        tmp_path = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
        tmp_path.close()
        sf.write(tmp_path.name, array16k, TARGET_SAMPLE_RATE, subtype='PCM_16')
        return tmp_path.name

    def _ensure_torch_images(self, images):
        if isinstance(images, torch.Tensor):
            tensor = images.detach().float()
            if tensor.ndim == 3:
                tensor = tensor.unsqueeze(0)
            if tensor.ndim == 4 and tensor.shape[1] in (1, 3) and tensor.shape[-1] not in (1, 3):
                tensor = tensor.permute(0, 2, 3, 1)
            return tensor
        return uint8_list_to_images(images_to_uint8_list(images)).float()

    def _run_wav2lip(self, images_uint8, wav_path, mode, face_detect_batch, passthrough):
        if not wav_path or not os.path.exists(wav_path):
            return passthrough
        wav2lip_fn = self._load_wav2lip_module()
        if wav2lip_fn is None:
            return passthrough
        _, model_path = self._resolve_paths()
        try:
            return wav2lip_fn(images_uint8, wav_path, face_detect_batch, mode, model_path)
        except Exception as exc:
            _warn(f'wav2lip_ failed, passthrough: {exc}')
            return passthrough

    def execute(self, images, audio, mode='sequential', face_detect_batch=8, on_no_face='passthrough'):
        normalized_mode = _normalize_mode(mode)
        torch_images = self._ensure_torch_images(images)
        sample_rate, mono_audio = self._to_mono_waveform(audio)
        tmp_path = None
        try:
            tmp_path = self._write_temp_wav((sample_rate, mono_audio))
            frames = self._run_wav2lip(images_to_uint8_list(torch_images), tmp_path, normalized_mode, face_detect_batch, torch_images)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        frames_tensor = None if frames is None else uint8_list_to_images(frames)
        is_empty = frames_tensor is None or (isinstance(frames_tensor, torch.Tensor) and (frames_tensor.numel() == 0 or frames_tensor.shape[0] == 0))
        if is_empty:
            if on_no_face == 'error':
                raise RuntimeError('Wav2Lip produced 0 frames (no face boxes)')
            return (torch_images,)
        return (frames_tensor,)
