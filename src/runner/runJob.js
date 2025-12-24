const fs = require('fs');
const { randomUUID } = require('crypto');
const path = require('path');
const validateJob = require('./validateJob');
const { buildPaths, prepareWorkdir, registerRun, stateRoot } = require('./paths');
const RunnerLogger = require('./logger');
const manifest = require('./manifest');
const { getAudioDurationSeconds } = require('./audio');
const {
  getFfmpegVersion,
  getFfprobeVersion,
  muxAudioVideo,
  createStillVideo,
  createMotionVideoFromImage,
  extractFirstFrame,
  padAudio,
  createVideoFromFrames,
  concatVideos,
} = require('./ffmpeg');
const { runLipSync } = require('./lipsync');
const { AppError } = require('../errors');
const { hashFileSha256 } = require('./hash');
const { generateSeed, normalizeSeed } = require('./seeds');
const { buildVidaxWav2LipImagePrompt, buildVidaxWav2LipVideoPrompt } = require('./comfyPromptBuilder');
const ComfyUIClient = require('../vidax/comfyuiClient');
const { resolveCustomNodesDir } = require('../setup/comfyPaths');
const { spawnSync } = require('child_process');

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

function countPngFrames(framesDir) {
  if (!framesDir || !fs.existsSync(framesDir)) return 0;
  const entries = fs.readdirSync(framesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png')).length;
}

function framesAvailable(framesDir, minimum = 1) {
  return countPngFrames(framesDir) >= minimum;
}

function ensureTempDir(tempDir) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function extractComfyNodeNames(objectInfo) {
  const nodes = objectInfo?.nodes || objectInfo?.data?.nodes || objectInfo?.data || {};
  return new Set(Object.keys(nodes || {}));
}

function validateComfyuiNodes(objectInfo, startSourceKind) {
  const nodeNames = extractComfyNodeNames(objectInfo);
  const required = ['LoadImage', 'RepeatImageBatch', 'LoadAudio', 'SaveImage', 'Wav2Lip'];
  if (startSourceKind === 'start_video') {
    required.push('VHS_LoadVideo');
  }
  const missing = required.filter((name) => !nodeNames.has(name));
  if (missing.length > 0) {
    throw new AppError('COMFYUI_MISSING_NODES', 'required ComfyUI nodes missing', { required, missing, start_source: startSourceKind });
  }
}

function assertWav2LipWeights() {
  const customNodesDir = resolveCustomNodesDir();
  const ganPath = path.join(customNodesDir, 'ComfyUI_wav2lip', 'Wav2Lip', 'checkpoints', 'wav2lip_gan.pth');
  const s3fdPath = path.join(customNodesDir, 'ComfyUI_wav2lip', 'Wav2Lip', 'face_detection', 'detection', 'sfd', 's3fd.pth');
  const missing = [];
  if (!fs.existsSync(ganPath)) missing.push(ganPath);
  if (!fs.existsSync(s3fdPath)) missing.push(s3fdPath);
  if (missing.length > 0) {
    throw new AppError('INPUT_NOT_FOUND', 'required Wav2Lip weights missing', { paths: missing });
  }
}

function selectVideoSource(job, paths, visualTargetDurationSeconds, fps, logger, targetWidth, targetHeight) {
  const startImage = job.input?.start_image;
  const startVideo = job.input?.start_video;
  ensureTempDir(paths.tempDir);

  if (startVideo) {
    logger.log({ level: 'info', stage: 'encode', message: 'using start_video source' });
    return { kind: 'start_video', path: startVideo, isImageSequence: false };
  }

  if (fs.existsSync(paths.comfyuiOutput)) {
    logger.log({ level: 'info', stage: 'encode', message: 'using comfyui output video' });
    return { kind: 'comfyui_video', path: paths.comfyuiOutput, isImageSequence: false };
  }

  if (framesAvailable(paths.framesDir)) {
    logger.log({ level: 'info', stage: 'encode', message: 'using comfyui frame sequence' });
    return { kind: 'frames', path: path.join(paths.framesDir, '%06d.png'), isImageSequence: true };
  }

  if (startImage) {
    const motionPath = path.join(paths.tempDir, 'motion_fallback.mp4');
    createMotionVideoFromImage({
      imagePath: startImage,
      fps,
      durationSeconds: visualTargetDurationSeconds,
      outPath: motionPath,
      targetWidth,
      targetHeight,
      seed: job?.comfyui?.seed,
    });
    logger.log({ level: 'info', stage: 'encode', message: 'using motion fallback from start_image' });
    return { kind: 'motion_fallback', path: motionPath, isImageSequence: false };
  }

  let dummySource = null;
  if (startVideo) {
    const extractPath = path.join(paths.tempDir, 'start_frame.png');
    extractFirstFrame({ videoInput: startVideo, outPath: extractPath });
    dummySource = extractPath;
  }
  if (!dummySource) {
    throw new AppError('INPUT_NOT_FOUND', 'no visual source available for dummy video');
  }
  const dummyOut = path.join(paths.tempDir, 'dummy.mp4');
  createStillVideo({
    imagePath: dummySource,
    fps,
    durationSeconds: visualTargetDurationSeconds,
    outPath: dummyOut,
    targetWidth,
    targetHeight,
  });
  logger.log({ level: 'info', stage: 'encode', message: 'using dummy video source' });
  return { kind: 'dummy', path: dummyOut, isImageSequence: false };
}

function resolveComfyResumeSource(paths, comfyPhase) {
  if (!comfyPhase || comfyPhase.status !== 'completed') {
    return { videoSource: null, outputKind: null, promptId: null };
  }
  const outputKind = comfyPhase.output_kind || null;
  const promptId = comfyPhase.prompt_id || null;
  if (outputKind === 'video') {
    const videoPath = (Array.isArray(comfyPhase.output_paths) && comfyPhase.output_paths[0]) || paths.comfyuiOutputVideo;
    if (videoPath && fs.existsSync(videoPath)) {
      return { videoSource: { kind: 'comfyui_video', path: videoPath, isImageSequence: false }, outputKind, promptId };
    }
  }
  if (outputKind === 'frames') {
    if (framesAvailable(paths.framesDir, 2)) {
      return {
        videoSource: { kind: 'comfyui_frames', path: path.join(paths.framesDir, '%06d.png'), isImageSequence: true },
        outputKind,
        promptId,
      };
    }
  }
  return { videoSource: null, outputKind, promptId };
}

function prepareLipsyncInput(videoSource, job, paths, visualTargetDurationSeconds, fps, logger, audioPath) {
  if (fs.existsSync(paths.comfyuiOutputVideo)) {
    return paths.comfyuiOutputVideo;
  }
  ensureTempDir(paths.tempDir);
  const target = paths.preLipsyncVideo;
  const holdSeconds = job?.buffer?.post_seconds ?? 0;
  if (videoSource.isImageSequence) {
    muxAudioVideo({
      videoInput: videoSource.path,
      audioInput: audioPath || job.input.audio,
      fps,
      outPath: target,
      maxDurationSeconds: visualTargetDurationSeconds,
      isImageSequence: true,
      holdSeconds,
    });
    logger.log({ level: 'info', stage: 'lipsync', message: 'rendered pre-lipsync video from frames' });
    return target;
  }
  if (videoSource.path !== target) {
    fs.copyFileSync(videoSource.path, target);
  }
  logger.log({ level: 'info', stage: 'lipsync', message: 'prepared pre-lipsync video source' });
  return target;
}

async function hashOrMissing(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    return 'INPUT_NOT_FOUND';
  }
  try {
    return await hashFileSha256(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return 'INPUT_NOT_FOUND';
    }
    throw err;
  }
}

async function computeInputHashes(job) {
  const startPath = job.input?.start_image || job.input?.start_video || null;
  const [start, audio, end] = await Promise.all([
    hashOrMissing(startPath),
    hashOrMissing(job.input?.audio || null),
    hashOrMissing(job.input?.end_image || null),
  ]);
  return { start, audio, end };
}

function shortHash(hashValue) {
  if (!hashValue || typeof hashValue !== 'string') return null;
  const normalized = hashValue.replace(/[^a-fA-F0-9]/g, '');
  if (!normalized) return null;
  return normalized.slice(0, 16);
}

function resolveComfyuiSeed(job, existingManifest) {
  const manifestSeed = existingManifest?.seeds?.comfyui_seed;
  const manifestPolicy = existingManifest?.seeds?.comfyui_seed_policy;
  const rawPolicy = manifestPolicy || job?.comfyui?.seed_policy || 'fixed';
  const policy = rawPolicy === 'random' ? 'random' : 'fixed';
  if (manifestSeed != null) {
    return { seed: manifestSeed, policy };
  }
  const providedSeed = job?.comfyui?.seed;
  if (policy === 'random') {
    return { seed: generateSeed(), policy };
  }
  const normalized = providedSeed != null ? normalizeSeed(providedSeed) : generateSeed();
  return { seed: normalized, policy };
}

function applyEffectiveSeed(job, comfyuiSeed, policy) {
  const comfyui = Object.assign({}, job.comfyui || {});
  comfyui.seed = comfyuiSeed;
  if (policy) {
    comfyui.seed_policy = policy;
  }
  return Object.assign({}, job, { comfyui });
}

function resolveWorkflowIds(job) {
  if (!job?.comfyui) return [];
  if (!Array.isArray(job.comfyui.workflow_ids)) return [];
  return job.comfyui.workflow_ids.filter(Boolean);
}

function resolveComfyuiClient(job, existingClient, vidaxOptions = {}) {
  if (existingClient) return existingClient;
  const comfyEnabled = job?.comfyui?.enable !== false;
  const workflowIds = resolveWorkflowIds(job);
  if (!comfyEnabled || !workflowIds.length) return null;
  const url = job?.comfyui?.server || 'http://127.0.0.1:8188';
  let inputDir = job?.comfyui?.input_dir || null;
  const comfyCwd = vidaxOptions?.processManager?.config?.comfyui?.cwd;
  if (comfyCwd) {
    inputDir = path.join(comfyCwd, 'input');
  }
  const clientConfig = {
    url,
    health_endpoint: job?.comfyui?.health_endpoint,
    prompt_endpoint: job?.comfyui?.prompt_endpoint,
    history_endpoint: job?.comfyui?.history_endpoint,
    view_endpoint: job?.comfyui?.view_endpoint,
    timeout_total: job?.comfyui?.timeout_total,
    input_dir: inputDir,
  };
  return new ComfyUIClient(clientConfig);
}

function probeImageSize(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=s=x:p=0',
    imagePath,
  ], { encoding: 'utf-8' });
  if (result.status !== 0 || !result.stdout) return null;
  const parts = result.stdout.trim().split('x');
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function probeVideoSize(videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) return null;
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=s=x:p=0',
    videoPath,
  ], { encoding: 'utf-8' });
  if (result.status !== 0 || !result.stdout) return null;
  const parts = result.stdout.trim().split('x');
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function resolveRenderSize(job) {
  const requested = job?.render || {};
  const comfyParams = job?.comfyui?.params || {};
  const explicitWidth = requested.requested_width || comfyParams.width || null;
  const explicitHeight = requested.requested_height || comfyParams.height || null;
  const maxWidth = requested.max_width || 854;
  const maxHeight = requested.max_height || 480;
  return { explicitWidth, explicitHeight, maxWidth, maxHeight };
}

function clampResolution(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  if (!sourceWidth || !sourceHeight) return { width: maxWidth, height: maxHeight };
  const width = Math.max(2, Math.round(sourceWidth));
  const height = Math.max(2, Math.round(sourceHeight));
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  let targetW = Math.max(2, Math.round(width * scale));
  let targetH = Math.max(2, Math.round(height * scale));
  if (targetW % 2 !== 0) targetW -= 1;
  if (targetH % 2 !== 0) targetH -= 1;
  return { width: targetW, height: targetH };
}

function resolveStartDimensions(job) {
  if (job.input?.start_image) {
    return probeImageSize(job.input.start_image);
  }
  if (job.input?.start_video) {
    return probeVideoSize(job.input.start_video);
  }
  return null;
}

function resolveLipsyncConfigPath(vidaxOptions = {}) {
  const vidaxStateDir = vidaxOptions.stateDir || vidaxOptions.processManager?.config?.state_dir || stateRoot;
  const stateConfig = path.join(vidaxStateDir, 'config', 'lipsync.providers.json');
  if (fs.existsSync(stateConfig)) {
    return stateConfig;
  }
  const repoConfig = path.join(process.cwd(), 'config', 'lipsync.providers.json');
  if (fs.existsSync(repoConfig)) {
    return repoConfig;
  }
  return stateConfig;
}

async function runJob(job, options = {}) {
  const validation = validateJob(job);
  if (!validation.valid) {
    throw new AppError('VALIDATION_ERROR', 'Job validation failed', { errors: validation.errors });
  }

  const normalizedJob = job;
  const startSourceKind = normalizedJob.input?.start_image ? 'start_image' : 'start_video';
  const resume = !!options.resume;
  const initialRunId = options.runId || randomUUID();
  const paths = buildPaths(normalizedJob, initialRunId);
  ensureOutputRules(paths, resume);

  const existingManifest = resume ? manifest.readManifest(paths.manifest) : null;
  const runId = existingManifest?.run_id || initialRunId;
  paths.runId = runId;
  let comfyuiClient = resolveComfyuiClient(normalizedJob, options?.vidax?.comfyuiClient, options?.vidax);
  const processManager = options?.vidax?.processManager;
  prepareWorkdir(paths);
  registerRun(runId, paths.base);

  fs.writeFileSync(paths.job, JSON.stringify(normalizedJob, null, 2));
  if (!resume || !existingManifest) {
    manifest.createDraft(paths.manifest, normalizedJob, runId);
  }
  const logger = new RunnerLogger(paths.events);
  logger.log({ level: 'info', stage: 'init', run_id: runId, message: resume ? 'job resume requested' : 'job queued' });
  const manifestPhases = existingManifest?.phases || {};
  const comfyResume = resolveComfyResumeSource(paths, manifestPhases.comfyui);
  const appliedBuffer = existingManifest?.buffer_applied || {
    pre_seconds: normalizedJob?.buffer?.pre_seconds ?? 0,
    post_seconds: normalizedJob?.buffer?.post_seconds ?? 0,
  };
  const needsPaddedAudio = (appliedBuffer.pre_seconds || appliedBuffer.post_seconds) > 0;
  const hasPaddedAudio = fs.existsSync(paths.paddedAudio);
  const skipPrepare = resume && manifestPhases.prepare?.status === 'completed' && (!needsPaddedAudio || hasPaddedAudio);
  const skipComfyui = resume && comfyResume.videoSource != null;
  const skipLipsync = resume && manifestPhases.lipsync?.status === 'completed' && fs.existsSync(paths.lipsyncOutputVideo);
  if (resume) {
    logger.log({
      level: 'info',
      stage: 'init',
      run_id: runId,
      message: 'resume mode active',
      skip: { prepare: skipPrepare, comfyui: skipComfyui, lipsync: skipLipsync, encode: false },
    });
  }

  let encodeStarted = null;
  try {
    let partialReason = null;
    let comfyuiOutputKind = comfyResume.outputKind || null;
    let comfyuiWorkflowId = existingManifest?.phases?.comfyui?.workflow_id || null;
    let lipsyncMode = skipLipsync ? 'external' : 'off';
    manifest.markStarted(paths.manifest);
    let comfyuiSeedInfo = resolveComfyuiSeed(normalizedJob, existingManifest);
    let effectiveJob = applyEffectiveSeed(normalizedJob, comfyuiSeedInfo.seed, comfyuiSeedInfo.policy);
    ensureTempDir(paths.tempDir);
    let inputHashes = null;
    let audioInputDurationSeconds = null;
    let preBufferSeconds = normalizedJob?.buffer?.pre_seconds ?? appliedBuffer.pre_seconds ?? 0;
    let postBufferSeconds = normalizedJob?.buffer?.post_seconds ?? appliedBuffer.post_seconds ?? 0;
    let visualTargetDurationSeconds = null;
    let renderWidth = null;
    let renderHeight = null;
    let effectiveAudioPath = normalizedJob.input.audio;
    let paddedAudioDurationSeconds = null;
    let prepareDetails = null;

    if (!skipPrepare) {
      manifest.recordPhase(paths.manifest, 'prepare', 'running');
      logger.log({ level: 'info', stage: 'prepare', message: 'preparing inputs' });
      inputHashes = await computeInputHashes(effectiveJob);
      audioInputDurationSeconds = getAudioDurationSeconds(normalizedJob.input?.audio);
      visualTargetDurationSeconds = audioInputDurationSeconds + preBufferSeconds + postBufferSeconds;
      const renderSizeConfig = resolveRenderSize(normalizedJob);
      const sourceDimensions = resolveStartDimensions(normalizedJob) || options?.vidax?.inputProbe?.startDimensions || null;
      renderWidth = renderSizeConfig.explicitWidth || (sourceDimensions && sourceDimensions.width) || renderSizeConfig.maxWidth;
      renderHeight = renderSizeConfig.explicitHeight || (sourceDimensions && sourceDimensions.height) || renderSizeConfig.maxHeight;
      const clamped = clampResolution(renderWidth, renderHeight, renderSizeConfig.maxWidth, renderSizeConfig.maxHeight);
      renderWidth = clamped.width;
      renderHeight = clamped.height;
      paddedAudioDurationSeconds = audioInputDurationSeconds;
      if (preBufferSeconds > 0 || postBufferSeconds > 0) {
        const paddedPath = padAudio({
          audioInput: normalizedJob.input.audio,
          preSeconds: preBufferSeconds,
          postSeconds: postBufferSeconds,
          targetDurationSeconds: visualTargetDurationSeconds,
          outPath: paths.paddedAudio,
        });
        effectiveAudioPath = paddedPath;
        try {
          paddedAudioDurationSeconds = getAudioDurationSeconds(paddedPath);
        } catch (err) {
          paddedAudioDurationSeconds = visualTargetDurationSeconds;
        }
      }
      visualTargetDurationSeconds = paddedAudioDurationSeconds ?? visualTargetDurationSeconds;
      prepareDetails = {
        audioInputDurationSeconds,
        audioDurationSeconds: paddedAudioDurationSeconds,
        visualTargetDurationSeconds,
        fps: normalizedJob.determinism?.fps ?? null,
        render_width: renderWidth,
        render_height: renderHeight,
        frameRounding: normalizedJob.determinism?.frame_rounding || 'ceil',
        comfyuiSeed: comfyuiSeedInfo.seed,
        comfyuiSeedPolicy: comfyuiSeedInfo.policy,
        bufferApplied: { pre_seconds: preBufferSeconds, post_seconds: postBufferSeconds },
        hashes: inputHashes,
        effectiveParams: effectiveJob,
      };
      manifest.recordPrepare(paths.manifest, prepareDetails);
      manifest.recordPhase(paths.manifest, 'prepare', 'completed');
    } else {
      logger.log({ level: 'info', stage: 'prepare', message: 'resume: reusing prepared inputs' });
      inputHashes = existingManifest?.input_hashes || null;
      audioInputDurationSeconds =
        existingManifest?.audio_input_duration_seconds ?? getAudioDurationSeconds(normalizedJob.input?.audio);
      paddedAudioDurationSeconds = existingManifest?.audio_duration_seconds ?? audioInputDurationSeconds;
      visualTargetDurationSeconds =
        existingManifest?.visual_target_duration_seconds ??
        audioInputDurationSeconds +
          (existingManifest?.buffer_applied?.pre_seconds ?? preBufferSeconds) +
          (existingManifest?.buffer_applied?.post_seconds ?? postBufferSeconds);
      const renderSizeConfig = resolveRenderSize(normalizedJob);
      const sourceDimensions = resolveStartDimensions(normalizedJob) || options?.vidax?.inputProbe?.startDimensions || null;
      renderWidth =
        existingManifest?.render_width ||
        renderSizeConfig.explicitWidth ||
        (sourceDimensions && sourceDimensions.width) ||
        renderSizeConfig.maxWidth;
      renderHeight =
        existingManifest?.render_height ||
        renderSizeConfig.explicitHeight ||
        (sourceDimensions && sourceDimensions.height) ||
        renderSizeConfig.maxHeight;
      const clamped = clampResolution(renderWidth, renderHeight, renderSizeConfig.maxWidth, renderSizeConfig.maxHeight);
      renderWidth = clamped.width;
      renderHeight = clamped.height;
      effectiveAudioPath = needsPaddedAudio && hasPaddedAudio ? paths.paddedAudio : normalizedJob.input.audio;
      visualTargetDurationSeconds = paddedAudioDurationSeconds ?? visualTargetDurationSeconds;
      prepareDetails = {
        audioInputDurationSeconds,
        audioDurationSeconds: paddedAudioDurationSeconds,
        visualTargetDurationSeconds,
        fps: normalizedJob.determinism?.fps ?? null,
        render_width: renderWidth,
        render_height: renderHeight,
        frameRounding: normalizedJob.determinism?.frame_rounding || 'ceil',
        comfyuiSeed: comfyuiSeedInfo.seed,
        comfyuiSeedPolicy: comfyuiSeedInfo.policy,
        bufferApplied: { pre_seconds: preBufferSeconds, post_seconds: postBufferSeconds },
        hashes: inputHashes,
        effectiveParams: effectiveJob,
      };
      comfyuiSeedInfo = {
        seed: prepareDetails.comfyuiSeed,
        policy: prepareDetails.comfyuiSeedPolicy,
      };
      effectiveJob = applyEffectiveSeed(normalizedJob, comfyuiSeedInfo.seed, comfyuiSeedInfo.policy);
    }
    manifest.recordVersions(paths.manifest, { ffmpeg: getFfmpegVersion(), ffprobe: getFfprobeVersion() });

    if (!inputHashes) {
      inputHashes = await computeInputHashes(effectiveJob);
    }
    if (!skipComfyui) {
      manifest.recordPhase(paths.manifest, 'comfyui', 'queued');
    }
    const workflowIds = resolveWorkflowIds(effectiveJob);
    const workflowId = workflowIds[0] || null;
    comfyuiWorkflowId = workflowId;
    let promptId = null;
    const comfyEnabled = effectiveJob?.comfyui?.enable !== false;
    let videoSource = null;
    if (!comfyEnabled) {
      logger.log({ level: 'info', stage: 'comfyui', message: 'comfyui disabled' });
      manifest.recordPhase(paths.manifest, 'comfyui', 'skipped', { note: 'disabled' });
    } else if (skipComfyui) {
      videoSource = comfyResume.videoSource;
      comfyuiOutputKind = comfyResume.outputKind || comfyuiOutputKind;
      promptId = comfyResume.promptId || promptId;
      if (comfyuiOutputKind) {
        lipsyncMode = 'inside_comfy';
      }
      logger.log({
        level: 'info',
        stage: 'comfyui',
        message: 'resume: reusing comfyui outputs',
        output_kind: comfyResume.outputKind,
      });
    } else if (!workflowId) {
      const err = new AppError('COMFYUI_UNAVAILABLE', 'workflow_id required when comfyui is enabled');
      manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { error: err.message, code: err.code });
      throw err;
    } else {
      logger.log({ level: 'info', stage: 'comfyui', message: 'starting comfyui submission' });
      manifest.recordPhase(paths.manifest, 'comfyui', 'running', { workflow_id: workflowId });
      try {
        if (processManager) {
          await processManager.ensureComfyUI({ requireWorkflows: true });
        }
      } catch (err) {
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      comfyuiClient = resolveComfyuiClient(effectiveJob, comfyuiClient, options?.vidax);
      if (!comfyuiClient) {
        const err = new AppError('COMFYUI_UNAVAILABLE', 'ComfyUI client unavailable');
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      const health = await comfyuiClient.health();
      if (!health?.ok) {
        const err = new AppError('COMFYUI_UNAVAILABLE', 'ComfyUI health check failed', { health });
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      const objectInfo = await comfyuiClient.getObjectInfo();
      if (!objectInfo?.ok) {
        const err = new AppError('COMFYUI_UNAVAILABLE', 'ComfyUI object_info check failed', { objectInfo });
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', { workflow_id: workflowId, error: err.message, code: err.code });
        throw err;
      }
      validateComfyuiNodes(objectInfo, startSourceKind);
      assertWav2LipWeights();
      const currentManifest = manifest.readManifest(paths.manifest) || {};
      const targetFrames =
        currentManifest.target_frames ??
        manifest.computeTargetFrames(
          prepareDetails.visualTargetDurationSeconds,
          prepareDetails.fps,
          prepareDetails.frameRounding
        );
      const frameCount = Math.max(1, targetFrames || 1);
      const postSeconds = normalizedJob.input?.end_image
        ? prepareDetails?.bufferApplied?.post_seconds ?? postBufferSeconds ?? 0
        : 0;
      const postFrames =
        normalizedJob.input?.end_image && postSeconds > 0 ? Math.ceil((prepareDetails.fps || 0) * postSeconds) : 0;
      const comfyFrameCount =
        normalizedJob.input?.end_image && postFrames > 0 ? Math.max(1, (targetFrames || 0) - postFrames) : frameCount;
      manifest.recordPhase(paths.manifest, 'comfyui', 'running', {
        workflow_id: workflowId,
        chunk_size: comfyFrameCount,
        chunk_count: 1,
      });
      try {
        const audioHash = shortHash(inputHashes.audio) || 'unknown';
        const startHash = shortHash(inputHashes.start) || 'unknown';
        const audioExt = path.extname(effectiveAudioPath || normalizedJob.input.audio);
        const startExt = normalizedJob.input.start_image
          ? path.extname(normalizedJob.input.start_image)
          : path.extname(normalizedJob.input.start_video);
        const audioName = `vidax_audio_${audioHash}${audioExt}`;
        const startName = `vidax_start_${startHash}${startExt}`;
        const stagedAudio = comfyuiClient.stageInputFile(effectiveAudioPath, audioName);
        const stagedStart = comfyuiClient.stageInputFile(
          normalizedJob.input.start_image || normalizedJob.input.start_video,
          startName
        );
        const audioInputName = stagedAudio?.name || audioName;
        const startInputName = stagedStart?.name || startName;
        const payload = normalizedJob.input.start_image
          ? buildVidaxWav2LipImagePrompt({
              startImageName: startInputName,
              audioName: audioInputName,
              fps: prepareDetails.fps,
              frameCount: comfyFrameCount,
              wav2lipMode: effectiveJob?.comfyui?.wav2lip?.mode,
              faceDetectBatch: effectiveJob?.comfyui?.wav2lip?.face_detect_batch,
            })
          : buildVidaxWav2LipVideoPrompt({
              startVideoName: startInputName,
              audioName: audioInputName,
              fps: prepareDetails.fps,
              frameCount: comfyFrameCount,
              width: renderWidth,
              height: renderHeight,
              wav2lipMode: effectiveJob?.comfyui?.wav2lip?.mode,
              faceDetectBatch: effectiveJob?.comfyui?.wav2lip?.face_detect_batch,
            });
        const submitResponse = await comfyuiClient.submitPrompt(payload);
        promptId = submitResponse?.prompt_id || submitResponse?.id || submitResponse?.promptId || null;
        if (!promptId) {
          const err = new AppError('COMFYUI_BAD_RESPONSE', 'ComfyUI prompt_id missing');
          manifest.recordPhase(paths.manifest, 'comfyui', 'failed', {
            workflow_id: workflowId,
            error: err.message,
            code: err.code,
          });
          throw err;
        }
        manifest.recordPhase(paths.manifest, 'comfyui', 'running', {
          workflow_id: workflowId,
          prompt_id: promptId,
          chunk_index: 0,
          chunk_size: comfyFrameCount,
          chunk_count: 1,
        });
        const waitResult = await comfyuiClient.waitForCompletion(promptId, {
          timeout_total: effectiveJob?.comfyui?.timeout_total ?? comfyuiClient.timeout,
          poll_interval_ms: effectiveJob?.comfyui?.poll_interval_ms || 500,
        });
        const collectResult = await comfyuiClient.collectOutputs(
          promptId,
          { videoPath: paths.comfyuiOutputVideo, framesDir: paths.framesDir, comfyuiDir: paths.comfyuiDir },
          { outputs: waitResult?.outputs }
        );
        if (!collectResult?.output_paths || collectResult.output_paths.length === 0) {
          throw new AppError('COMFYUI_BAD_RESPONSE', 'ComfyUI returned no outputs', { prompt_id: promptId });
        }
        if (collectResult.output_kind === 'frames' && !framesAvailable(paths.framesDir, 2)) {
          throw new AppError('COMFYUI_BAD_RESPONSE', 'ComfyUI returned insufficient frames', {
            frames_dir: paths.framesDir,
            output_paths: collectResult.output_paths,
          });
        }
        manifest.recordPhase(paths.manifest, 'comfyui', 'running', {
          workflow_id: workflowId,
          prompt_id: promptId,
          chunk_index: 0,
          chunk_size: comfyFrameCount,
          chunk_count: 1,
          output_kind: collectResult.output_kind,
          output_paths: collectResult.output_paths,
        });
        comfyuiOutputKind = collectResult.output_kind || null;
        if (comfyuiOutputKind) {
          lipsyncMode = 'inside_comfy';
        }
        if (collectResult.output_kind === 'video' && collectResult.output_paths?.length) {
          videoSource = { kind: 'comfyui_video', path: collectResult.output_paths[0], isImageSequence: false };
        } else if (collectResult.output_kind === 'frames') {
          videoSource = { kind: 'comfyui_frames', path: path.join(paths.framesDir, '%06d.png'), isImageSequence: true };
        }
        manifest.recordPhase(paths.manifest, 'comfyui', 'completed', {
          workflow_id: workflowId,
          prompt_id: promptId,
          chunk_size: comfyFrameCount,
          chunk_count: 1,
          output_kind: collectResult.output_kind,
          output_paths: collectResult.output_paths,
        });
      } catch (err) {
        manifest.recordPhase(paths.manifest, 'comfyui', 'failed', {
          workflow_id: workflowId,
          prompt_id: promptId,
          error: err.message,
          code: err.code,
        });
        throw err;
      }
    }

    manifest.recordPhase(paths.manifest, 'stabilize', 'skipped');
    const lipsyncEnabled = normalizedJob?.lipsync?.enable === true;
    const lipsyncProvider = normalizedJob?.lipsync?.provider || null;
    const allowPassthrough = normalizedJob?.lipsync?.params?.allow_passthrough === true;
    if (comfyEnabled && !videoSource) {
      const err = new AppError('COMFYUI_BAD_RESPONSE', 'ComfyUI produced no usable outputs', {
        phase: manifestPhases.comfyui || null,
      });
      throw err;
    }
    if (!videoSource) {
      videoSource = selectVideoSource(
        normalizedJob,
        paths,
        visualTargetDurationSeconds,
        prepareDetails.fps,
        logger,
        renderWidth,
        renderHeight
      );
      if (videoSource && !videoSource.kind.startsWith('diagnostic_fallback_')) {
        videoSource = Object.assign({}, videoSource, { kind: `diagnostic_fallback_${videoSource.kind}` });
      }
    }
    let encodeVideoSource = videoSource;

    if (skipLipsync) {
      logger.log({ level: 'info', stage: 'lipsync', message: 'resume: reusing lipsync output' });
      encodeVideoSource = { kind: 'lipsync_video', path: paths.lipsyncOutputVideo, isImageSequence: false };
      lipsyncMode = 'external';
    } else if (!lipsyncEnabled) {
      manifest.recordPhase(paths.manifest, 'lipsync', 'skipped', { note: 'disabled' });
    } else if (!lipsyncProvider) {
      manifest.recordPhase(paths.manifest, 'lipsync', 'skipped', { note: 'provider missing' });
    } else {
      manifest.recordVersions(paths.manifest, { lipsync_provider: lipsyncProvider });
      manifest.recordPhase(paths.manifest, 'lipsync', 'queued', { provider: lipsyncProvider, out_path: paths.lipsyncOutputVideo });
      let preLipVideoPath = null;
      try {
        preLipVideoPath = prepareLipsyncInput(
          videoSource,
          normalizedJob,
          paths,
          visualTargetDurationSeconds,
          prepareDetails.fps,
          logger,
          effectiveAudioPath
        );
        lipsyncMode = 'external';
      } catch (err) {
        manifest.recordPhase(paths.manifest, 'lipsync', 'failed', {
          provider: lipsyncProvider,
          error: err.message,
          code: err.code,
          out_path: paths.lipsyncOutputVideo,
          allow_passthrough: allowPassthrough,
        });
        if (allowPassthrough) {
          partialReason = 'lipsync_failed_passthrough';
          lipsyncMode = 'external';
          logger.log({
            level: 'warn',
            stage: 'lipsync',
            message: 'failed to prepare lipsync input; allow_passthrough=true so continuing',
            code: err.code,
          });
        } else {
          throw err;
        }
      }
      if (!preLipVideoPath) {
        encodeVideoSource = videoSource;
      } else {
        manifest.recordPhase(paths.manifest, 'lipsync', 'running', {
          provider: lipsyncProvider,
          input_video: preLipVideoPath,
          out_path: paths.lipsyncOutputVideo,
        });
        try {
          await runLipSync({
            provider: lipsyncProvider,
            params: normalizedJob?.lipsync?.params || {},
            audioPath: effectiveAudioPath,
            videoPath: preLipVideoPath,
            outPath: paths.lipsyncOutputVideo,
            cwd: paths.base,
            logger,
            configPath: resolveLipsyncConfigPath(options?.vidax),
          });
          manifest.recordPhase(paths.manifest, 'lipsync', 'completed', {
            provider: lipsyncProvider,
            out_path: paths.lipsyncOutputVideo,
          });
          encodeVideoSource = { kind: 'lipsync_video', path: paths.lipsyncOutputVideo, isImageSequence: false };
        } catch (err) {
          manifest.recordPhase(paths.manifest, 'lipsync', 'failed', {
            provider: lipsyncProvider,
            error: err.message,
            code: err.code,
            out_path: paths.lipsyncOutputVideo,
            allow_passthrough: allowPassthrough,
          });
          if (allowPassthrough) {
            partialReason = 'lipsync_failed_passthrough';
            lipsyncMode = 'external';
            logger.log({
              level: 'warn',
              stage: 'lipsync',
              message: 'lipsync failed but allow_passthrough=true; continuing with original video source',
              code: err.code,
            });
          } else {
            throw err;
          }
        }
      }
    }

    manifest.recordPhase(paths.manifest, 'encode', 'queued');
    logger.log({ level: 'info', stage: 'encode', message: 'starting ffmpeg mux' });

    // Convert image sequences to video and apply end_image hold if requested
    const processedVideos = [];
    if (encodeVideoSource.isImageSequence) {
      const framesVideo = path.join(paths.tempDir, 'frames_video.mp4');
      createVideoFromFrames({
        framesPattern: encodeVideoSource.path,
        fps: prepareDetails.fps,
        outPath: framesVideo,
        targetWidth: renderWidth,
        targetHeight: renderHeight,
      });
      processedVideos.push(framesVideo);
      const nextKind = encodeVideoSource.kind;
      encodeVideoSource = { kind: nextKind, path: framesVideo, isImageSequence: false };
    } else {
      processedVideos.push(encodeVideoSource.path);
    }

    if (normalizedJob.input?.end_image && (normalizedJob.buffer?.post_seconds || 0) > 0) {
      const holdPath = path.join(paths.tempDir, 'end_hold.mp4');
      createStillVideo({
        imagePath: normalizedJob.input.end_image,
        fps: prepareDetails.fps,
        durationSeconds: normalizedJob.buffer.post_seconds,
        outPath: holdPath,
        targetWidth: renderWidth,
        targetHeight: renderHeight,
      });
      processedVideos.push(holdPath);
      const concatPath = path.join(paths.tempDir, 'with_end.mp4');
      concatVideos(processedVideos, concatPath, {
        fps: prepareDetails.fps,
        targetWidth: renderWidth,
        targetHeight: renderHeight,
      });
      encodeVideoSource = { kind: `${encodeVideoSource.kind}_with_end`, path: concatPath, isImageSequence: false };
    }

    encodeStarted = Date.now();
    const encodeStartIso = new Date(encodeStarted).toISOString();
    manifest.recordPhase(paths.manifest, 'encode', 'running', {
      fps: prepareDetails.fps,
      render_width: renderWidth,
      render_height: renderHeight,
      started_at: encodeStartIso,
    });
    muxAudioVideo({
      videoInput: encodeVideoSource.path,
      audioInput: effectiveAudioPath,
      fps: prepareDetails.fps,
      outPath: paths.final,
      maxDurationSeconds: visualTargetDurationSeconds,
      holdSeconds: normalizedJob.input?.end_image ? 0 : postBufferSeconds,
      isImageSequence: encodeVideoSource.isImageSequence,
      targetWidth: renderWidth,
      targetHeight: renderHeight,
    });
    const videoSourceLabel = encodeVideoSource.kind.endsWith('_with_end')
      ? encodeVideoSource.kind.replace(/_with_end$/, '')
      : encodeVideoSource.kind;
    const encodeCompletedAt = Date.now();
    manifest.recordPhase(paths.manifest, 'encode', 'completed', {
      fps: prepareDetails.fps,
      video_source: videoSourceLabel,
      duration_cap_seconds: visualTargetDurationSeconds,
      audio_duration_seconds: paddedAudioDurationSeconds,
      audio_path: effectiveAudioPath,
      render_width: renderWidth,
      render_height: renderHeight,
      started_at: encodeStartIso,
      completed_at: new Date(encodeCompletedAt).toISOString(),
      duration_ms: encodeCompletedAt - encodeStarted,
      video_source_detail: {
        start_source: startSourceKind,
        comfyui_workflow_id: comfyuiWorkflowId,
        comfyui_output: comfyuiOutputKind,
        lipsync: lipsyncMode,
        video_source: videoSourceLabel,
      },
    });

    if (fs.existsSync(paths.tempDir)) {
      try {
        fs.rmSync(paths.tempDir, { recursive: true, force: true });
        logger.log({ level: 'info', stage: 'cleanup', message: 'temp directory removed' });
      } catch (err) {
        logger.log({
          level: 'warn',
          stage: 'cleanup',
          message: 'failed to remove temp directory',
          error: err.message,
        });
      }
    }

    manifest.markFinished(paths.manifest, 'success', { partial_reason: partialReason });
    logger.log({ level: 'info', stage: 'done', run_id: runId, message: 'job complete with encoded output' });

    return { runId, status: 'success', paths };
  } catch (err) {
    if (encodeStarted != null) {
      const encodeFailedAt = Date.now();
      manifest.recordPhase(paths.manifest, 'encode', 'failed', {
        error: err.message,
        code: err.code,
        started_at: encodeStarted != null ? new Date(encodeStarted).toISOString() : null,
        completed_at: new Date(encodeFailedAt).toISOString(),
        duration_ms: encodeStarted != null ? encodeFailedAt - encodeStarted : null,
      });
    }
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
