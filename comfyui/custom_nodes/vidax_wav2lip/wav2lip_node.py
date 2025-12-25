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

    def _run_wav2lip(self, images, wav_path, mode, face_detect_batch):
        wav2lip_fn = self._load_wav2lip_module()
        if wav2lip_fn is None:
            return images
        _, model_path = self._resolve_paths()
        try:
            return wav2lip_fn(images, wav_path, face_detect_batch, mode, model_path)
        except Exception as exc:
            _warn(f'wav2lip_ failed, returning passthrough frames: {exc}')
            return images

    def _frames_to_list(self, frames):
        if frames is None:
            return None
        if isinstance(frames, torch.Tensor):
            tensor = frames.detach().cpu()
            if tensor.dim() == 4 and tensor.shape[1] in (1, 3):
                tensor = tensor.permute(0, 2, 3, 1)
            if tensor.dtype != torch.uint8:
                tensor = torch.clamp(tensor, 0, 255).byte()
            return [frame.numpy() for frame in tensor]
        if isinstance(frames, (list, tuple)):
            converted = []
            for frame in frames:
                if isinstance(frame, torch.Tensor):
                    sub_frames = self._frames_to_list(frame)
                    if sub_frames:
                        converted.extend(sub_frames)
                else:
                    np_frame = np.array(frame)
                    if np_frame.dtype != np.uint8:
                        np_frame = np.clip(np_frame, 0, 255).astype(np.uint8)
                    converted.append(np_frame)
            return converted
        return frames

    def execute(self, images, audio, mode='sequential', face_detect_batch=8, on_no_face='passthrough'):
        normalized_mode = _normalize_mode(mode)
        sample_rate, mono_audio = self._to_mono_waveform(audio)
        tmp_path = None
        try:
            tmp_path = self._write_temp_wav((sample_rate, mono_audio))
            frames = self._run_wav2lip(images, tmp_path, normalized_mode, face_detect_batch)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        frames = self._frames_to_list(frames)
        if frames is None:
            is_empty = True
        elif isinstance(frames, (list, tuple)):
            is_empty = len(frames) == 0
        else:
            is_empty = False
        if is_empty:
            if on_no_face == 'error':
                raise RuntimeError('Wav2Lip produced 0 frames (no face boxes)')
            return (images,)
        return (frames,)
