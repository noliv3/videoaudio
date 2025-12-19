const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AppError } = require('../errors');

const MAX_LOG_CHARS = 5000;

function loadProviderRegistry(configPath) {
  if (!configPath) {
    throw new AppError('VALIDATION_ERROR', 'lipsync config path missing');
  }
  if (!fs.existsSync(configPath)) {
    throw new AppError('VALIDATION_ERROR', 'lipsync provider config missing', { configPath });
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content || '{}');
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', 'invalid lipsync provider config', { configPath, error: err.message });
  }
}

function applyTemplate(value, context) {
  return value
    .replaceAll('{audio}', context.audioPath)
    .replaceAll('{video}', context.videoPath)
    .replaceAll('{out}', context.outPath);
}

function paramsToArgs(params = {}) {
  const args = [];
  Object.entries(params || {}).forEach(([key, val]) => {
    if (val === undefined || val === null) return;
    if (typeof val === 'object') return;
    const normalized = typeof val === 'boolean' ? (val ? 'true' : 'false') : String(val);
    args.push(`--${key}=${normalized}`);
  });
  return args;
}

function buildArgs(template = [], context = {}, params = {}) {
  const baseArgs = (template || []).map((entry) => applyTemplate(String(entry), context));
  const paramArgs = paramsToArgs(params);
  return [...baseArgs, ...paramArgs];
}

function runLipSync({ provider, params, audioPath, videoPath, outPath, cwd, logger, configPath }) {
  if (!provider) {
    throw new AppError('VALIDATION_ERROR', 'lipsync provider missing');
  }
  if (!audioPath || !videoPath || !outPath) {
    throw new AppError('LIPSYNC_FAILED', 'lipsync missing required paths', { audioPath, videoPath, outPath });
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const registry = loadProviderRegistry(configPath);
  const providerConfig = registry[provider];
  if (!providerConfig) {
    throw new AppError('VALIDATION_ERROR', 'unknown lipsync provider', { provider });
  }
  const args = buildArgs(providerConfig.args_template || [], { audioPath, videoPath, outPath }, params);
  return new Promise((resolve, reject) => {
    const child = spawn(providerConfig.command, args, { cwd: cwd || process.cwd(), shell: true });
    const logStream = (stream, chunk) => {
      if (!logger) return;
      const text = chunk ? String(chunk) : '';
      const message = text.length > MAX_LOG_CHARS ? text.slice(0, MAX_LOG_CHARS) : text;
      logger.log({
        level: 'info',
        stage: 'lipsync',
        stream,
        message,
        truncated: text.length > MAX_LOG_CHARS,
      });
    };
    child.stdout.on('data', (data) => logStream('stdout', data));
    child.stderr.on('data', (data) => logStream('stderr', data));
    child.on('error', (err) => {
      reject(new AppError('LIPSYNC_FAILED', 'failed to start lipsync provider', { provider, error: err.message }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AppError('LIPSYNC_FAILED', `lipsync exited with code ${code}`, { provider, code }));
        return;
      }
      if (!fs.existsSync(outPath)) {
        reject(new AppError('LIPSYNC_FAILED', 'lipsync produced no output', { outPath }));
        return;
      }
      resolve({ provider, outPath });
    });
  });
}

module.exports = { runLipSync, buildArgs, loadProviderRegistry };
