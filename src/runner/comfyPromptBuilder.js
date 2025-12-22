function asPositiveInt(value, fallback) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
}

function buildTextToImagePrompt(options = {}) {
  const width = asPositiveInt(options.width, 1024);
  const height = asPositiveInt(options.height, 576);
  const frameCount = asPositiveInt(options.frame_count, 1) || 1;
  const seed = asPositiveInt(options.seed, 0);
  const steps = asPositiveInt(options.steps, 20);
  const cfg = typeof options.cfg === 'number' && Number.isFinite(options.cfg) ? options.cfg : 7.5;
  const sampler = options.sampler || 'dpmpp_2m';
  const scheduler = options.scheduler || 'karras';
  const prompt = options.prompt || '';
  const negative = options.negative || '';
  const prefix = options.filename_prefix || 'vidax';
  const checkpoint = options.checkpoint || 'sd_xl_base_1.0.safetensors';

  return {
    prompt: {
      1: {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: checkpoint },
      },
      2: {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: prompt,
          clip: [1, 'CLIP'],
        },
      },
      3: {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: negative,
          clip: [1, 'CLIP'],
        },
      },
      4: {
        class_type: 'EmptyLatentImage',
        inputs: {
          width,
          height,
          batch_size: frameCount,
        },
      },
      5: {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps,
          cfg,
          sampler_name: sampler,
          scheduler,
          denoise: 1,
          model: [1, 'MODEL'],
          positive: [2, 'CONDITIONING'],
          negative: [3, 'CONDITIONING'],
          latent_image: [4, 'LATENT'],
        },
      },
      6: {
        class_type: 'VAEDecode',
        inputs: {
          samples: [5, 'LATENT'],
          vae: [1, 'VAE'],
        },
      },
      7: {
        class_type: 'SaveImage',
        inputs: {
          images: [6, 'IMAGE'],
          filename_prefix: prefix,
        },
      },
    },
  };
}

module.exports = { buildTextToImagePrompt };
