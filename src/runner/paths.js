const fs = require('fs');
const os = require('os');
const path = require('path');

const stateDir = process.env.VA_STATE_DIR || path.join(os.homedir(), '.va');
const stateRoot = path.join(stateDir, 'state');
const registryPath = path.join(stateRoot, 'runs.json');

function ensureStateDir() {
  fs.mkdirSync(stateRoot, { recursive: true });
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, JSON.stringify({}), 'utf-8');
  }
}

function readRegistry() {
  ensureStateDir();
  try {
    const content = fs.readFileSync(registryPath, 'utf-8');
    return JSON.parse(content || '{}');
  } catch (err) {
    return {};
  }
}

function writeRegistry(data) {
  ensureStateDir();
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf-8');
}

function registerRun(runId, workdir) {
  const data = readRegistry();
  data[runId] = { workdir };
  writeRegistry(data);
}

function resolveRun(runId) {
  const data = readRegistry();
  return data[runId];
}

function buildPaths(job, runId) {
  const base = path.resolve(job.output.workdir);
  const logsDir = path.join(base, 'logs');
  const events = path.join(logsDir, 'events.jsonl');
  const manifest = path.join(base, 'manifest.json');
  const finalName = job.output.final_name || 'final.mp4';
  const comfyuiDir = path.join(base, 'comfyui');
  const lipsyncDir = path.join(base, 'lipsync');
  const faceprobeDir = path.join(base, 'faceprobe');
  const motionDir = path.join(base, 'motion');
  const motionFramesDir = path.join(motionDir, 'frames');
  const mouthBlendDir = path.join(base, 'mouthblend');
  const mouthBlendFramesDir = path.join(mouthBlendDir, 'frames');
  const faceprobeDebugDir = path.join(faceprobeDir, 'debug');
  const framesDir = path.join(base, 'frames');
  const tempDir = path.join(base, 'temp');
  const motionBaseVideo = path.join(base, 'motion_base.mp4');
  return {
    runId,
    base,
    logsDir,
    events,
    manifest,
    comfyuiDir,
    comfyuiOutput: path.join(comfyuiDir, 'comfyui_video.mp4'),
    comfyuiOutputVideo: path.join(comfyuiDir, 'comfyui_video.mp4'),
    lipsyncDir,
    lipsyncOutputVideo: path.join(lipsyncDir, 'output.mp4'),
    faceprobeDir,
    faceprobeDebugDir,
    motionDir,
    motionFramesDir,
    mouthBlendDir,
    mouthBlendFramesDir,
    framesDir,
    tempDir,
    motionBaseVideo,
    paddedAudio: path.join(tempDir, 'padded_audio.m4a'),
    preLipsyncVideo: path.join(tempDir, 'pre_lipsync.mp4'),
    final: path.join(base, finalName),
    job: path.join(base, 'job.json')
  };
}

function prepareWorkdir(paths) {
  fs.mkdirSync(paths.base, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
}

module.exports = {
  buildPaths,
  prepareWorkdir,
  registerRun,
  resolveRun,
  stateDir,
  stateRoot,
  registryPath
};
