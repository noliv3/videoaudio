import importlib.util
import os
import tempfile

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

    def _resolve_paths(self):
        base_dir = os.path.abspath(os.path.dirname(__file__))
        custom_nodes_root = os.path.abspath(os.path.join(base_dir, os.pardir))
        module_path = os.path.join(custom_nodes_root, 'ComfyUI_wav2lip', 'Wav2Lip', 'wav2lip_node.py')
        model_path = os.path.join(custom_nodes_root, 'ComfyUI_wav2lip', 'Wav2Lip', 'checkpoints', 'wav2lip_gan.pth')
        return module_path, model_path

    def _load_wav2lip_module(self):
        if self._cached_module is not None:
            return self._cached_module
        module_path, _ = self._resolve_paths()
        if not os.path.exists(module_path):
            _warn('ComfyUI_wav2lip is missing; returning passthrough frames')
            self._cached_module = None
            return None
        try:
            spec = importlib.util.spec_from_file_location('vidax_wav2lip_external', module_path)
            if not spec or not spec.loader:
                _warn('Unable to load ComfyUI_wav2lip module; returning passthrough frames')
                self._cached_module = None
                return None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self._cached_module = module
            return module
        except Exception as exc:
            _warn(f'Failed to import ComfyUI_wav2lip: {exc}')
            self._cached_module = None
            return None

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
        module = self._load_wav2lip_module()
        if module is None:
            return images
        _, model_path = self._resolve_paths()
        try:
            return module.wav2lip_(images, wav_path, face_detect_batch, mode, model_path)
        except Exception as exc:
            _warn(f'wav2lip_ failed, returning passthrough frames: {exc}')
            return images

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
        if not frames or (isinstance(frames, (list, tuple)) and len(frames) == 0):
            if on_no_face == 'error':
                raise RuntimeError('VIDAX Wav2Lip produced no frames')
            return (images,)
        return (frames,)
