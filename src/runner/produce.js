const path = require('path');
const { AppError } = require('../errors');

const imageExt = ['.png', '.jpg', '.jpeg', '.webp'];
const videoExt = ['.mp4', '.mov', '.mkv'];

function resolveStartField(startPath) {
  if (!startPath) {
    throw new AppError('VALIDATION_ERROR', 'start input is required');
  }
  const ext = path.extname(startPath).toLowerCase();
  if (imageExt.includes(ext)) {
    return { start_image: startPath };
  }
  if (videoExt.includes(ext)) {
    return { start_video: startPath };
  }
  throw new AppError('UNSUPPORTED_FORMAT', 'unsupported start input format', { start: startPath });
}

function normalizeNumber(value, fieldName, fallback) {
  if (value == null || value === '') return fallback;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    throw new AppError('VALIDATION_ERROR', `${fieldName} must be a finite number`, { field: fieldName, value });
  }
  return numeric;
}

function resolveResolution(options = {}) {
  const resString = options.resolution || options.resolution_string || options.res;
  if (resString && typeof resString === 'string' && resString.includes('x')) {
    const [w, h] = resString.toLowerCase().split('x');
    const widthParsed = normalizeNumber(Number(w), 'width', null);
    const heightParsed = normalizeNumber(Number(h), 'height', null);
    return { width: widthParsed, height: heightParsed };
  }
  const width = normalizeNumber(options.width ?? options.resolution_width, 'width', null);
  const height = normalizeNumber(options.height ?? options.resolution_height, 'height', null);
  return { width, height };
}

function resolveMaxRender(options = {}) {
  const maxWidth = normalizeNumber(options.max_width ?? options.max_render_width, 'max_width', 854);
  const maxHeight = normalizeNumber(options.max_height ?? options.max_render_height, 'max_height', 480);
  return { maxWidth, maxHeight };
}

function resolveWorkdir(inputWorkdir, runId) {
  if (inputWorkdir) {
    return path.resolve(inputWorkdir);
  }
  const suffix = runId ? `run-${runId}` : `run-${Date.now()}`;
  return path.join(process.cwd(), 'workdir', suffix);
}

function buildProduceJob(raw = {}, options = {}) {
  const audio = raw.audio || raw.audio_a;
  if (!audio) {
    throw new AppError('VALIDATION_ERROR', 'audio input is required');
  }
  const start = raw.start || raw.start_a;
  const startFields = resolveStartField(start);
  const endImage = raw.end || raw.end_c || raw.end_image;
  const prompt = raw.prompt ?? raw.motion_prompt ?? undefined;
  const negative = raw.negative ?? raw.neg ?? raw.negative_prompt ?? undefined;
  const preSeconds = normalizeNumber(raw.pre ?? raw.pre_seconds, 'pre_seconds', 0);
  const postSeconds = normalizeNumber(raw.post ?? raw.post_seconds, 'post_seconds', 0);
  const fps = normalizeNumber(raw.fps, 'fps', 25);
  const seedPolicy = raw.seed_policy || 'fixed';
  const lipsyncFlag = raw.lipsync || raw.lipsync_enable;
  const lipsyncEnable = lipsyncFlag === 'on' || lipsyncFlag === true || (lipsyncFlag == null && !!startFields.start_image);
  const lipsyncProvider = raw.lipsync_provider || options.lipsyncProvider || null;
  const { width, height } = resolveResolution(raw);
  const { maxWidth, maxHeight } = resolveMaxRender(raw);
  const workdir = resolveWorkdir(raw.workdir || options.defaultWorkdir, options.runId);
  const defaultWorkflowId = startFields.start_image
    ? ['vidax_faceprobe', 'vidax_motion_chunks', 'vidax_lipsync_mouthblend']
    : ['vidax_wav2lip_video_audio'];
  const workflowId = raw.workflow_id || options.workflowId || defaultWorkflowId;
  const comfyUrl = raw.comfyui_server || raw.comfyui_url || options.comfyuiUrl || 'http://127.0.0.1:8188';
  const finalName = raw.final_name || raw.output_name || 'fertig.mp4';
  const comfyuiEnabled = raw.no_comfyui === true ? false : raw.comfyui_enable === false ? false : true;
  const comfyChunkSize = raw.comfyui_chunk_size || raw.chunk_size || null;

  return {
    input: Object.assign(
      {
        audio,
        end_image: endImage || null,
      },
      startFields
    ),
    render: {
      requested_width: width || null,
      requested_height: height || null,
      max_width: maxWidth,
      max_height: maxHeight,
    },
    buffer: { pre_seconds: preSeconds, post_seconds: postSeconds },
    motion: { prompt: prompt, guidance: raw.guidance || 7.5 },
    output: { workdir, final_name: finalName, emit_manifest: true, emit_logs: true },
    determinism: { fps, audio_master: true, frame_rounding: 'ceil' },
    comfyui: {
      server: comfyUrl,
      workflow_ids: Array.isArray(workflowId) ? workflowId : [workflowId],
      enable: comfyuiEnabled,
      seed_policy: seedPolicy,
      seed: raw.seed != null ? raw.seed : undefined,
      chunk_size: comfyChunkSize,
      params: {
        prompt,
        negative,
        width: width || undefined,
        height: height || undefined,
        steps: raw.steps,
        cfg: raw.cfg,
        sampler: raw.sampler,
        scheduler: raw.scheduler,
      },
    },
    lipsync: {
      enable: lipsyncEnable,
      provider: lipsyncProvider,
      params: {
        allow_passthrough: raw.allow_passthrough === true,
      },
    },
  };
}

module.exports = { buildProduceJob };
