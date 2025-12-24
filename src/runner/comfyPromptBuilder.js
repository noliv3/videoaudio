function asPositiveInt(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
}

function buildVidaxWav2LipImagePrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 1) || 1;
  const fps = asPositiveInt(options.fps, 25) || 25;
  const startImageName = options.startImageName;
  const audioName = options.audioName;

  return {
    prompt: {
      1: {
        class_type: 'LoadImage',
        inputs: { image: startImageName },
      },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: {
          image: ['1', 0],
          amount: frameCount,
        },
      },
      3: {
        class_type: 'LoadAudio',
        inputs: { audio: audioName },
      },
      4: {
        class_type: 'Wav2Lip',
        inputs: {
          images: ['2', 0],
          audio: ['3', 0],
        },
      },
      5: {
        class_type: 'SaveImage',
        inputs: { images: ['4', 0], filename_prefix: 'vidax_wav2lip' },
      },
    },
  };
}

function buildVidaxWav2LipVideoPrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 1) || 1;
  const fps = asPositiveInt(options.fps, 25) || 25;
  const width = asPositiveInt(options.width, 854) || 854;
  const height = asPositiveInt(options.height, 480) || 480;
  const startVideoName = options.startVideoName;
  const audioName = options.audioName;

  return {
    prompt: {
      1: {
        class_type: 'VHS_LoadVideo',
        inputs: {
          video: startVideoName,
          force_rate: fps,
          frame_load_cap: frameCount,
          force_size: 'Custom',
          custom_width: width,
          custom_height: height,
        },
      },
      2: {
        class_type: 'LoadAudio',
        inputs: { audio: audioName },
      },
      3: {
        class_type: 'Wav2Lip',
        inputs: {
          images: ['1', 0],
          audio: ['2', 0],
        },
      },
      4: {
        class_type: 'SaveImage',
        inputs: { images: ['3', 0], filename_prefix: 'vidax_wav2lip' },
      },
    },
  };
}

module.exports = { buildVidaxWav2LipImagePrompt, buildVidaxWav2LipVideoPrompt };
