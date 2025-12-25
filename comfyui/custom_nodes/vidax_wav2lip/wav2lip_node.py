import os
import tempfile
import numpy as np
import torch
import torchaudio
import soundfile as sf

try:
    # Prefer the shipped ComfyUI Wav2Lip implementation for inference.
    from custom_nodes.ComfyUI_wav2lip import wav2lip_node as base_node
except Exception:
    base_node = None


class VidaxWav2Lip:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "audio": ("AUDIO",),
                "mode": (["sequential", "parallel"], {"default": "sequential"}),
                "face_detect_batch": ("INT", {"default": 8, "min": 1, "max": 64, "step": 1}),
                "on_no_face": (["passthrough", "error"], {"default": "passthrough"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "execute"
    CATEGORY = "VIDAX/LipSync"

    def _normalize_audio(self, audio):
        if isinstance(audio, (list, tuple)) and len(audio) >= 2:
            sample_rate, waveform = audio[0], audio[1]
        else:
            sample_rate, waveform = 16000, audio
        if isinstance(waveform, torch.Tensor):
            tensor = waveform
        else:
            tensor = torch.tensor(np.array(waveform))
        if tensor.dim() > 1:
            tensor = tensor.mean(dim=0)
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            tensor = resampler(tensor)
            sample_rate = 16000
        if tensor.dim() == 1:
            tensor = tensor.unsqueeze(0)
        np_audio = tensor.squeeze(0).cpu().numpy()
        return sample_rate, np_audio

    def _run_wav2lip(self, images, audio_path, mode, face_detect_batch):
        if base_node is None or not hasattr(base_node, "Wav2Lip"):
            return images
        try:
            node = base_node.Wav2Lip()
            # The upstream node exposes different entrypoints depending on version.
            for candidate in ("wav2lip", "do_wav2lip", "execute"):
                func = getattr(node, candidate, None)
                if callable(func):
                    return func(images, audio_path, mode, face_detect_batch)
        except Exception:
            return images
        return images

    def execute(self, images, audio, mode="sequential", face_detect_batch=8, on_no_face="passthrough"):
        sample_rate, np_audio = self._normalize_audio(audio)
        if sample_rate != 16000:
            # Ensure 16 kHz even when upstream transforms were skipped.
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            np_audio = resampler(torch.tensor(np_audio).unsqueeze(0)).squeeze(0).numpy()
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                tmp_path = tmp.name
                sf.write(tmp_path, np_audio, 16000, subtype="PCM_16")
            frames = self._run_wav2lip(images, tmp_path, mode, face_detect_batch)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        if not frames or (isinstance(frames, (list, tuple)) and len(frames) == 0):
            if on_no_face == "error":
                raise RuntimeError("VIDAX Wav2Lip produced no frames")
            return (images,)
        return (frames,)
