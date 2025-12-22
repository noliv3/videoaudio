const fs = require('fs');
const path = require('path');
const { MIN_SEED, MAX_SEED } = require('./seeds');

const imageExt = ['.png', '.jpg', '.jpeg', '.webp'];
const videoExt = ['.mp4', '.mov', '.mkv'];
const audioExt = ['.wav', '.mp3', '.flac', '.m4a'];

function validateJob(job) {
  const errors = [];
  if (!job || typeof job !== 'object') {
    return { valid: false, code: 'VALIDATION_ERROR', errors: [{ field: 'job', message: 'Job payload must be object' }] };
  }

  validateInput(job.input, errors);
  validateBuffer(job.buffer, errors);
  validateTiming(job, errors);
  validateOutput(job.output, errors);
  validateDeterminism(job.determinism, errors);
  validateComfy(job.comfyui, errors);
  validateLipsync(job.lipsync, errors);

  return { valid: errors.length === 0, code: errors.length ? 'VALIDATION_ERROR' : null, errors };
}

function validateInput(input, errors) {
  if (!input || typeof input !== 'object') {
    errors.push({ field: 'input', message: 'input section required', code: 'VALIDATION_ERROR' });
    return;
  }
  const hasImage = !!input.start_image;
  const hasVideo = !!input.start_video;
  if (hasImage === hasVideo) {
    errors.push({ field: 'input.start_image', message: 'exactly one of start_image or start_video required', code: 'VALIDATION_ERROR' });
  }
  if (!input.audio) {
    errors.push({ field: 'input.audio', message: 'audio is required', code: 'VALIDATION_ERROR' });
  }
  checkPath(input.start_image, imageExt, 'input.start_image', errors);
  checkPath(input.start_video, videoExt, 'input.start_video', errors);
  checkPath(input.audio, audioExt, 'input.audio', errors);
  if (input.end_image) {
    checkPath(input.end_image, imageExt, 'input.end_image', errors, false);
  }
}

function checkPath(value, allowedExt, field, errors, required = false) {
  if (!value) {
    if (required) {
      errors.push({ field, message: 'missing required path', code: 'VALIDATION_ERROR' });
    }
    return;
  }
  const ext = path.extname(value).toLowerCase();
  if (!allowedExt.includes(ext)) {
    errors.push({ field, message: 'unsupported format', code: 'UNSUPPORTED_FORMAT' });
  }
  if (!fs.existsSync(value)) {
    errors.push({ field, message: 'input not found', code: 'INPUT_NOT_FOUND' });
  }
}

function validateTiming(job, errors) {
  const timing = job.timing;
  const timingFile = job.timing_file || job?.timing?.timing_file;
  const hasTimingObj = timing && typeof timing === 'object' && Object.keys(timing).length > 0;
  if (timingFile && hasTimingObj) {
    errors.push({ field: 'timing', message: 'timing and timing_file cannot both be set', code: 'VALIDATION_ERROR' });
  }
}

function validateOutput(output, errors) {
  if (!output || typeof output !== 'object') {
    errors.push({ field: 'output', message: 'output section required', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!output.workdir) {
    errors.push({ field: 'output.workdir', message: 'workdir is required', code: 'VALIDATION_ERROR' });
  }
  if (output.final_name && path.basename(output.final_name) !== output.final_name) {
    errors.push({ field: 'output.final_name', message: 'final_name must be a basename under workdir', code: 'VALIDATION_ERROR' });
  }
  if (output.emit_manifest === false) {
    errors.push({ field: 'output.emit_manifest', message: 'manifest is mandatory', code: 'VALIDATION_ERROR' });
  }
  if (output.emit_logs === false) {
    errors.push({ field: 'output.emit_logs', message: 'at least one log form must be emitted', code: 'VALIDATION_ERROR' });
  }
}

function validateDeterminism(determinism, errors) {
  if (!determinism || typeof determinism !== 'object') {
    errors.push({ field: 'determinism', message: 'determinism section required', code: 'VALIDATION_ERROR' });
    return;
  }
  if (determinism.fps == null) {
    errors.push({ field: 'determinism.fps', message: 'fps required', code: 'VALIDATION_ERROR' });
  }
  if (determinism.audio_master === false) {
    errors.push({ field: 'determinism.audio_master', message: 'audio_master must stay true', code: 'VALIDATION_ERROR' });
  }
  if (determinism.frame_rounding && !['ceil', 'round'].includes(determinism.frame_rounding)) {
    errors.push({ field: 'determinism.frame_rounding', message: 'frame_rounding must be ceil or round', code: 'VALIDATION_ERROR' });
  }
}

function validateComfy(comfyui, errors) {
  if (!comfyui) {
    errors.push({ field: 'comfyui', message: 'comfyui section required (default enabled)', code: 'VALIDATION_ERROR' });
    return;
  }
  if (typeof comfyui !== 'object') {
    errors.push({ field: 'comfyui', message: 'comfyui must be object', code: 'VALIDATION_ERROR' });
    return;
  }
  const workflowIds = Array.isArray(comfyui.workflow_ids) ? comfyui.workflow_ids.filter(Boolean) : [];
  if (!Array.isArray(comfyui.workflow_ids) && comfyui.workflow_ids != null) {
    errors.push({ field: 'comfyui.workflow_ids', message: 'workflow_ids must be array', code: 'VALIDATION_ERROR' });
  }
  const comfyEnabled = comfyui.enable !== false;
  if (workflowIds.length > 0 && !comfyui.server) {
    errors.push({ field: 'comfyui.server', message: 'server url required when workflows are set', code: 'VALIDATION_ERROR' });
  }
  if (comfyEnabled && workflowIds.length === 0) {
    errors.push({ field: 'comfyui.workflow_ids', message: 'workflow_ids required when comfyui is enabled', code: 'VALIDATION_ERROR' });
  }
  if (comfyui.seed_policy && !['fixed', 'random'].includes(comfyui.seed_policy)) {
    errors.push({ field: 'comfyui.seed_policy', message: 'seed_policy must be fixed or random', code: 'VALIDATION_ERROR' });
  }
  if (comfyui.seed_policy === 'random' && comfyui.seed != null) {
    errors.push({ field: 'comfyui.seed', message: 'seed not allowed when seed_policy is random', code: 'VALIDATION_ERROR' });
  }
  validateSeedValue(comfyui.seed, errors);
  validateComfyParams(comfyui.params, errors);
}

function validateLipsync(lipsync, errors) {
  if (!lipsync) return;
  if (typeof lipsync !== 'object') {
    errors.push({ field: 'lipsync', message: 'lipsync must be object', code: 'VALIDATION_ERROR' });
    return;
  }
  if (lipsync.enable !== false && !lipsync.provider) {
    errors.push({ field: 'lipsync.provider', message: 'provider required when lipsync is enabled', code: 'VALIDATION_ERROR' });
  }
  if (lipsync.enable === false && lipsync.provider) {
    errors.push({ field: 'lipsync.provider', message: 'provider ignored when disabled', code: 'VALIDATION_ERROR' });
  }
}

function validateBuffer(buffer, errors) {
  if (!buffer) return;
  if (typeof buffer !== 'object') {
    errors.push({ field: 'buffer', message: 'buffer must be object', code: 'VALIDATION_ERROR' });
    return;
  }
  const pre = buffer.pre_seconds ?? 0;
  const post = buffer.post_seconds ?? 0;
  if (buffer.pre_seconds != null && typeof buffer.pre_seconds !== 'number') {
    errors.push({ field: 'buffer.pre_seconds', message: 'pre_seconds must be number', code: 'VALIDATION_ERROR' });
  }
  if (buffer.post_seconds != null && typeof buffer.post_seconds !== 'number') {
    errors.push({ field: 'buffer.post_seconds', message: 'post_seconds must be number', code: 'VALIDATION_ERROR' });
  }
  if (buffer.audio_padding != null && typeof buffer.audio_padding !== 'boolean') {
    errors.push({ field: 'buffer.audio_padding', message: 'audio_padding must be boolean', code: 'VALIDATION_ERROR' });
  }
  if (pre < 0) {
    errors.push({ field: 'buffer.pre_seconds', message: 'pre_seconds cannot be negative', code: 'VALIDATION_ERROR' });
  }
  if (post < 0) {
    errors.push({ field: 'buffer.post_seconds', message: 'post_seconds cannot be negative', code: 'VALIDATION_ERROR' });
  }
}

function validateSeedValue(seed, errors) {
  if (seed == null) return;
  const numeric = typeof seed === 'string' ? Number(seed) : seed;
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || !Number.isInteger(numeric)) {
    errors.push({ field: 'comfyui.seed', message: 'seed must be a finite integer', code: 'VALIDATION_ERROR' });
    return;
  }
  if (numeric < MIN_SEED || numeric > MAX_SEED) {
    errors.push({
      field: 'comfyui.seed',
      message: `seed must be between ${MIN_SEED} and ${MAX_SEED}`,
      code: 'VALIDATION_ERROR',
    });
  }
}

function validateComfyParams(params, errors) {
  if (!params) return;
  if (typeof params !== 'object') {
    errors.push({ field: 'comfyui.params', message: 'params must be object', code: 'VALIDATION_ERROR' });
    return;
  }
  if (params.prompt != null && typeof params.prompt !== 'string') {
    errors.push({ field: 'comfyui.params.prompt', message: 'prompt must be string', code: 'VALIDATION_ERROR' });
  }
  if (params.negative != null && typeof params.negative !== 'string') {
    errors.push({ field: 'comfyui.params.negative', message: 'negative must be string', code: 'VALIDATION_ERROR' });
  }
  if (params.negative_prompt != null && typeof params.negative_prompt !== 'string') {
    errors.push({ field: 'comfyui.params.negative_prompt', message: 'negative_prompt must be string', code: 'VALIDATION_ERROR' });
  }
  validatePositiveInt(params.width, 'comfyui.params.width', errors);
  validatePositiveInt(params.height, 'comfyui.params.height', errors);
  validatePositiveInt(params.steps, 'comfyui.params.steps', errors);
  if (params.cfg != null && (typeof params.cfg !== 'number' || !Number.isFinite(params.cfg))) {
    errors.push({ field: 'comfyui.params.cfg', message: 'cfg must be a finite number', code: 'VALIDATION_ERROR' });
  }
  if (params.sampler != null && typeof params.sampler !== 'string') {
    errors.push({ field: 'comfyui.params.sampler', message: 'sampler must be string', code: 'VALIDATION_ERROR' });
  }
  if (params.scheduler != null && typeof params.scheduler !== 'string') {
    errors.push({ field: 'comfyui.params.scheduler', message: 'scheduler must be string', code: 'VALIDATION_ERROR' });
  }
}

function validatePositiveInt(value, field, errors) {
  if (value == null) return;
  if (!Number.isInteger(value) || value <= 0) {
    errors.push({ field, message: 'must be a positive integer', code: 'VALIDATION_ERROR' });
  }
}

module.exports = validateJob;
