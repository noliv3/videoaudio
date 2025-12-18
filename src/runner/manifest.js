const fs = require('fs');

function writeManifest(path, manifest) {
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function readManifest(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw || '{}');
}

function baseManifest(job, runId) {
  const now = new Date().toISOString();
  const fps = job?.determinism?.fps ?? null;
  return {
    run_id: runId,
    status: 'queued',
    run_status: 'queued',
    timestamps: {
      created: now,
      started: null,
      finished: null,
    },
    input_hashes: {
      start: null,
      audio: null,
      end: null,
    },
    audio_duration_seconds: null,
    visual_target_duration_seconds: null,
    buffer_applied: null,
    fps,
    target_frames: null,
    effective_params: job || {},
    versions: {
      runner: '0.1.0',
      comfyui_api: 'pending',
      lipsync_provider: 'pending',
      ffmpeg: 'unknown',
      ffprobe: 'unknown',
    },
    seeds: {
      comfyui_seed: job?.comfyui?.seed ?? null,
      lipsync_seed: null,
    },
    exit_status: null,
    partial_reason: null,
    phases: {},
  };
}

function createDraft(manifestPath, job, runId) {
  const manifest = baseManifest(job, runId);
  writeManifest(manifestPath, manifest);
  return manifest;
}

function updateManifest(manifestPath, updater) {
  const current = readManifest(manifestPath) || {};
  const next = updater({ ...current });
  writeManifest(manifestPath, next);
  return next;
}

function markStarted(manifestPath) {
  return updateManifest(manifestPath, (m) => {
    m.status = 'running';
    m.run_status = 'running';
    m.exit_status = null;
    m.partial_reason = null;
    m.timestamps = m.timestamps || {};
    m.timestamps.started = new Date().toISOString();
    return m;
  });
}

function markFinished(manifestPath, exitStatus, extra = {}) {
  return updateManifest(manifestPath, (m) => {
    const terminal = exitStatus === 'failed' ? 'failed' : 'completed';
    m.status = terminal;
    m.run_status = terminal;
    m.exit_status = exitStatus ?? null;
    m.partial_reason = extra.partial_reason ?? m.partial_reason ?? null;
    m.timestamps = m.timestamps || {};
    m.timestamps.finished = new Date().toISOString();
    if (extra.error) {
      m.error = extra.error;
    }
    return m;
  });
}

function recordPhase(manifestPath, phase, status, extra = {}) {
  return updateManifest(manifestPath, (m) => {
    m.phases = m.phases || {};
    m.phases[phase] = {
      status,
      updated: new Date().toISOString(),
      ...extra,
    };
    return m;
  });
}

function recordPrepare(manifestPath, details) {
  return updateManifest(manifestPath, (m) => {
    const audioDuration = details.audioDurationSeconds ?? m.audio_duration_seconds;
    const fps = details.fps ?? m.fps;
    const targetFrames = computeTargetFrames(audioDuration, fps, details.frameRounding);
    m.audio_duration_seconds = audioDuration;
    m.visual_target_duration_seconds = audioDuration;
    m.buffer_applied = details.bufferApplied ?? m.buffer_applied ?? null;
    m.fps = fps;
    m.target_frames = targetFrames;
    m.input_hashes = details.hashes || m.input_hashes || {};
    m.seeds = {
      ...m.seeds,
      comfyui_seed: details.comfyuiSeed ?? m.seeds?.comfyui_seed ?? null,
    };
    return m;
  });
}

function computeTargetFrames(audioDuration, fps, rounding = 'ceil') {
  if (audioDuration == null || fps == null) return null;
  const frames = fps * audioDuration;
  if (rounding === 'round') {
    return Math.round(frames);
  }
  return Math.ceil(frames);
}

module.exports = {
  createDraft,
  markStarted,
  markFinished,
  recordPhase,
  recordPrepare,
  readManifest,
  computeTargetFrames,
};
