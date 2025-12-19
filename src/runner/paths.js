const fs = require('fs');
const os = require('os');
const path = require('path');

const stateDir = process.env.VA_STATE_DIR || path.join(os.homedir(), '.va');
const registryPath = path.join(stateDir, 'runs.json');

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
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
  const framesDir = path.join(base, 'frames');
  const tempDir = path.join(base, 'temp');
  return {
    runId,
    base,
    logsDir,
    events,
    manifest,
    comfyuiDir,
    comfyuiOutput: path.join(comfyuiDir, 'output.mp4'),
    comfyuiOutputVideo: path.join(comfyuiDir, 'output.mp4'),
    lipsyncDir,
    lipsyncOutputVideo: path.join(lipsyncDir, 'output.mp4'),
    framesDir,
    tempDir,
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
  registryPath
};
