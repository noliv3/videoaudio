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
    audio_input_duration_seconds: null,
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
      comfyui_seed_policy: job?.comfyui?.seed_policy ?? 'fixed',
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
  const next = updater(Object.assign({}, current));
  writeManifest(manifestPath, next);
  return next;
}

function recordVersions(manifestPath, versions = {}) {
  return updateManifest(manifestPath, (m) => {
    m.versions = Object.assign({}, m.versions || {}, versions);
    return m;
  });
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
    const phaseDetails = Object.assign({ status, updated: new Date().toISOString() }, extra || {});
    m.phases[phase] = phaseDetails;
    return m;
  });
}

function recordPrepare(manifestPath, details) {
  return updateManifest(manifestPath, (m) => {
    const audioInputDuration = details.audioInputDurationSeconds ?? m.audio_input_duration_seconds ?? null;
    const audioDuration = details.audioDurationSeconds ?? m.audio_duration_seconds ?? audioInputDuration;
    const fps = details.fps ?? m.fps;
    const bufferApplied = normalizeBuffer(details.bufferApplied, m.buffer_applied);
    const visualDuration = resolveVisualDuration(
      details.visualTargetDurationSeconds,
      audioDuration,
      bufferApplied,
      audioInputDuration
    );
    const targetFrames = computeTargetFrames(visualDuration, fps, details.frameRounding);
    m.audio_input_duration_seconds = audioInputDuration ?? audioDuration;
    m.audio_duration_seconds = audioDuration;
    m.visual_target_duration_seconds = visualDuration;
    m.buffer_applied = bufferApplied;
    m.fps = fps;
    m.target_frames = targetFrames;
    if (details.render_width) {
      m.render_width = details.render_width;
    }
    if (details.render_height) {
      m.render_height = details.render_height;
    }
    m.input_hashes = details.hashes || m.input_hashes || {};
    const seeds = Object.assign({}, m.seeds || {});
    seeds.comfyui_seed = details.comfyuiSeed ?? (m.seeds ? m.seeds.comfyui_seed : null) ?? null;
    seeds.comfyui_seed_policy =
      details.comfyuiSeedPolicy ?? (m.seeds ? m.seeds.comfyui_seed_policy : null) ?? 'fixed';
    m.seeds = seeds;
    if (details.effectiveParams) {
      m.effective_params = details.effectiveParams;
    }
    return m;
  });
}

function normalizeBuffer(bufferApplied, current) {
  const buffer = bufferApplied ?? current ?? { pre_seconds: 0, post_seconds: 0 };
  return {
    pre_seconds: buffer.pre_seconds ?? 0,
    post_seconds: buffer.post_seconds ?? 0,
  };
}

function resolveVisualDuration(visualTargetDurationSeconds, audioDuration, bufferApplied, audioInputDuration) {
  if (visualTargetDurationSeconds != null) return visualTargetDurationSeconds;
  const baseAudio = audioDuration ?? audioInputDuration;
  if (baseAudio == null) return null;
  const pre = bufferApplied?.pre_seconds ?? 0;
  const post = bufferApplied?.post_seconds ?? 0;
  return baseAudio + pre + post;
}

function computeTargetFrames(durationSeconds, fps, rounding = 'ceil') {
  if (durationSeconds == null || fps == null) return null;
  const frames = fps * durationSeconds;
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
  recordVersions,
  readManifest,
  computeTargetFrames,
};
