const fs = require('fs');
const { randomUUID } = require('crypto');
const path = require('path');
const validateJob = require('./validateJob');
const { buildPaths, prepareWorkdir, registerRun } = require('./paths');
const RunnerLogger = require('./logger');
const manifest = require('./manifest');
const { getAudioDurationSeconds } = require('./audio');
const { getFfmpegVersion, muxAudioVideo, createStillVideo, extractFirstFrame } = require('./ffmpeg');
const { AppError } = require('../errors');

function ensureOutputRules(paths, resume) {
  const manifestExists = fs.existsSync(paths.manifest);
  const finalExists = fs.existsSync(paths.final);
  if (resume) {
    if (!manifestExists) {
      throw new AppError('OUTPUT_WRITE_FAILED', 'resume requires existing manifest', { manifest: paths.manifest });
    }
    if (finalExists) {
      throw new AppError('OUTPUT_WRITE_FAILED', 'cannot resume when final output already exists', { final: paths.final });
    }
    return;
  }
  if (finalExists) {
    throw new AppError('OUTPUT_WRITE_FAILED', 'final output already exists; use --resume to continue', { final: paths.final });
  }
}

function framesAvailable(framesDir) {
  if (!framesDir || !fs.existsSync(framesDir)) return false;
  const entries = fs.readdirSync(framesDir, { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'));
}

function ensureTempDir(tempDir) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function selectVideoSource(job, paths, audioDurationSeconds, fps, logger) {
  if (fs.existsSync(paths.comfyuiOutput)) {
    logger.log({ level: 'info', stage: 'encode', message: 'using comfyui output video' });
    return { kind: 'comfyui_video', path: paths.comfyuiOutput, isImageSequence: false };
  }

  if (framesAvailable(paths.framesDir)) {
    logger.log({ level: 'info', stage: 'encode', message: 'using comfyui frame sequence' });
    return { kind: 'frames', path: path.join(paths.framesDir, '%06d.png'), isImageSequence: true };
  }

  const startImage = job.input?.start_image;
  const startVideo = job.input?.start_video;
  ensureTempDir(paths.tempDir);
  let stillPath = startImage;
  if (!stillPath && startVideo) {
    const extractPath = path.join(paths.tempDir, 'start_frame.png');
    extractFirstFrame({ videoInput: startVideo, outPath: extractPath });
    stillPath = extractPath;
  }
  if (!stillPath) {
    throw new AppError('INPUT_NOT_FOUND', 'no visual source available for dummy video');
  }
  const dummyOut = path.join(paths.tempDir, 'dummy.mp4');
  createStillVideo({ imagePath: stillPath, fps, durationSeconds: audioDurationSeconds, outPath: dummyOut });
  logger.log({ level: 'info', stage: 'encode', message: 'using dummy video source' });
  return { kind: 'dummy', path: dummyOut, isImageSequence: false };
}

async function runJob(job, options = {}) {
  const validation = validateJob(job);
  if (!validation.valid) {
    throw new AppError('VALIDATION_ERROR', 'Job validation failed', { errors: validation.errors });
  }

  const resume = !!options.resume;
  const initialRunId = options.runId || randomUUID();
  const paths = buildPaths(job, initialRunId);
  ensureOutputRules(paths, resume);

  const existingManifest = resume ? manifest.readManifest(paths.manifest) : null;
  const runId = existingManifest?.run_id || initialRunId;
  paths.runId = runId;
  const comfyuiClient = options?.vidax?.comfyuiClient;
  const processManager = options?.vidax?.processManager;
  prepareWorkdir(paths);
  registerRun(runId, paths.base);

  fs.writeFileSync(paths.job, JSON.stringify(job, null, 2));
  if (!resume || !existingManifest) {
    manifest.createDraft(paths.manifest, job, runId);
  }
  const logger = new RunnerLogger(paths.events);
  logger.log({ level: 'info', stage: 'init', run_id: runId, message: resume ? 'job resume requested' : 'job queued' });

  try {
    manifest.markStarted(paths.manifest);
    manifest.recordPhase(paths.manifest, 'prepare', 'running');
    logger.log({ level: 'info', stage: 'prepare', message: 'preparing inputs' });
    const audioDurationSeconds = getAudioDurationSeconds(job.input?.audio);
    const prepareDetails = {
      audioDurationSeconds,
      fps: job.determinism?.fps ?? null,
      frameRounding: job.determinism?.frame_rounding || 'ceil',
      comfyuiSeed: job.comfyui?.seed ?? null,
      hashes: {
        start: job.input?.start_image || job.input?.start_video || null,
        audio: job.input?.audio || null,
        end: job.input?.end_image || null,
      },
    };
    manifest.recordPrepare(paths.manifest, prepareDetails);
    manifest.recordPhase(paths.manifest, 'prepare', 'completed');
    manifest.recordVersions(paths.manifest, { ffmpeg: getFfmpegVersion() });

    manifest.recordPhase(paths.manifest, 'comfyui', 'queued');
    const workflowId = job?.comfyui?.workflow_ids?.[0] || null;
    if (!workflowId) {
      logger.log({ level: 'info', stage: 'comfyui', message: 'workflow_id missing, skipping' });
      manifest.recordPhase(paths.manifest, 'comfyui', 'skipped', { note: 'workflow_id missing' });
    } else {
      logger.log({ level: 'info', stage: 'comfyui', message: 'starting comfyui submission' });
      manifest.recordPhase(paths.manifest, 'comfyui', 'running', { workflow_id: workflowId });
      try {
        if (processManager) {
          await processManager.ensureComfyUI();
        }
      } catch (err) {
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      if (!comfyuiClient) {
        const err = new AppError('COMFYUI_BAD_RESPONSE', 'ComfyUI client unavailable');
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      const currentManifest = manifest.readManifest(paths.manifest) || {};
      const payload = {
        workflow_id: workflowId,
        seed: currentManifest.seeds?.comfyui_seed ?? job?.comfyui?.seed ?? null,
        fps: currentManifest.fps ?? prepareDetails.fps ?? null,
        target_frames: currentManifest.target_frames ?? null,
        prompt: job?.motion?.prompt ?? null,
      };
      try {
        const response = await comfyuiClient.submitPrompt(payload);
        manifest.recordPhase(paths.manifest, 'comfyui', 'completed', {
          workflow_id: workflowId,
          prompt_id: response?.prompt_id ?? null,
        });
      } catch (err) {
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', {
          workflow_id: workflowId,
          error: err.message,
          code: err.code,
        });
        throw err;
      }
    }

    manifest.recordPhase(paths.manifest, 'stabilize', 'skipped');
    manifest.recordPhase(paths.manifest, 'lipsync', 'skipped');
    manifest.recordPhase(paths.manifest, 'encode', 'queued');
    logger.log({ level: 'info', stage: 'encode', message: 'starting ffmpeg mux' });

    manifest.recordPhase(paths.manifest, 'encode', 'running', { fps: prepareDetails.fps });
    const videoSource = selectVideoSource(job, paths, audioDurationSeconds, prepareDetails.fps, logger);
    muxAudioVideo({
      videoInput: videoSource.path,
      audioInput: job.input.audio,
      fps: prepareDetails.fps,
      outPath: paths.final,
      maxDurationSeconds: audioDurationSeconds,
      isImageSequence: videoSource.isImageSequence,
    });
    manifest.recordPhase(paths.manifest, 'encode', 'completed', {
      fps: prepareDetails.fps,
      video_source: videoSource.kind,
      duration_cap_seconds: audioDurationSeconds,
    });

    manifest.markFinished(paths.manifest, 'success', { partial_reason: null });
    logger.log({ level: 'info', stage: 'done', run_id: runId, message: 'job complete with encoded output' });

    return { runId, status: 'success', paths };
  } catch (err) {
    manifest.recordPhase(paths.manifest, 'encode', 'failed', { error: err.message, code: err.code });
    manifest.markFinished(paths.manifest, 'failed', {
      error: {
        code: err.code || 'FFMPEG_FAILED',
        message: err.message,
        details: err.details || null,
      },
    });
    logger.log({ level: 'error', stage: 'error', message: err.message, code: err.code });
    if (err instanceof AppError) {
      throw err;
    }
    const wrapped = new AppError(err.code || 'FFMPEG_FAILED', err.message, err.details || {});
    throw wrapped;
  }
}

module.exports = runJob;
