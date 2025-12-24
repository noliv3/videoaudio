function asPositiveInt(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
}

function asPositiveNumber(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}

function buildVidaxWav2LipImagePrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 1) || 1;
  const fps = asPositiveInt(options.fps, 25) || 25;
  const startImageName = options.startImageName;
  const audioName = options.audioName;
  const wav2lipMode = options.wav2lipMode ?? 'sequential';
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  const filenamePrefix =
    options.outputPrefix || options.filenamePrefix || options.output_prefix || options.workdirPrefix || 'vidax_wav2lip';

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
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
        },
      },
      5: {
        class_type: 'SaveImage',
        inputs: { images: ['4', 0], filename_prefix: filenamePrefix },
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
  const wav2lipMode = options.wav2lipMode ?? 'sequential';
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  const filenamePrefix =
    options.outputPrefix || options.filenamePrefix || options.output_prefix || options.workdirPrefix || 'vidax_wav2lip';

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
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
        },
      },
      4: {
        class_type: 'SaveImage',
        inputs: { images: ['3', 0], filename_prefix: filenamePrefix },
      },
    },
  };
}

function buildVidaxFaceProbePrompt(options = {}) {
  const startImageName = options.startImageName;
  const angles = Array.isArray(options.angles) && options.angles.length ? options.angles : [];
  const paddedAngles = angles.length ? angles : Array.from({ length: 13 }, (_, idx) => -30 + idx * 5);
  const filenamePrefix = options.outputPrefix || 'vidax_faceprobe';
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_crop` },
      },
      3: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_debug` },
      },
      4: {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: `${filenamePrefix}_meta` },
      },
    },
    meta: { angles: paddedAngles },
  };
}

function buildVidaxMotionChunksPrompt(options = {}) {
  const startImageName = options.startImageName;
  const frameCount = asPositiveInt(options.frameCount, 16) || 16;
  const fps = asPositiveNumber(options.fps, 8) || 8;
  const filenamePrefix = options.outputPrefix || 'vidax_motion';
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: { image: ['1', 0], amount: frameCount },
      },
      3: {
        class_type: 'SaveImage',
        inputs: { images: ['2', 0], filename_prefix: filenamePrefix },
      },
    },
    meta: { fps, frame_count: frameCount },
  };
}

function buildVidaxLipsyncMouthBlendPrompt(options = {}) {
  const frameCount = asPositiveInt(options.frameCount, 16) || 16;
  const fps = asPositiveNumber(options.fps, 8) || 8;
  const audioName = options.audioName;
  const startImageName = options.startImageName;
  const filenamePrefix = options.outputPrefix || 'vidax_mouthblend';
  const wav2lipMode = options.wav2lipMode ?? 'sequential';
  const faceDetectBatch = asPositiveInt(options.faceDetectBatch, 8) || 8;
  return {
    prompt: {
      1: { class_type: 'LoadImage', inputs: { image: startImageName } },
      2: {
        class_type: 'RepeatImageBatch',
        inputs: { image: ['1', 0], amount: frameCount },
      },
      3: { class_type: 'LoadAudio', inputs: { audio: audioName } },
      4: {
        class_type: 'Wav2Lip',
        inputs: {
          images: ['2', 0],
          audio: ['3', 0],
          mode: wav2lipMode,
          face_detect_batch: faceDetectBatch,
        },
      },
      5: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: filenamePrefix } },
    },
    meta: { fps, frame_count: frameCount },
  };
}

module.exports = {
  buildVidaxWav2LipImagePrompt,
  buildVidaxWav2LipVideoPrompt,
  buildVidaxFaceProbePrompt,
  buildVidaxMotionChunksPrompt,
  buildVidaxLipsyncMouthBlendPrompt,
};
