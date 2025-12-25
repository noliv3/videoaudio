const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { AppError, mapErrorToExitCode } = require('../errors');
const ComfyUIClient = require('../vidax/comfyuiClient');
const { resolveCustomNodesDir, resolveComfyPython } = require('./comfyPaths');

function checkCommand(command, args = ['-version'], options = {}) {
  const { critical = true } = options;
  try {
    const result = spawnSync(command, args, { encoding: 'utf-8' });
    const ok = result.status === 0;
    const version = ok ? (result.stdout || result.stderr || '').split('\n')[0].trim() : null;
    return { name: command, ok, critical, version, error: ok ? null : result.error || result.stderr || result.stdout };
  } catch (err) {
    return { name: command, ok: false, critical, version: null, error: err.message };
  }
}

function checkWav2LipWeights() {
  const customNodesDir = resolveCustomNodesDir();
  const checks = [];
  const ganPath = path.join(customNodesDir, 'ComfyUI_wav2lip', 'Wav2Lip', 'checkpoints', 'wav2lip_gan.pth');
  const s3fdPath = path.join(customNodesDir, 'ComfyUI_wav2lip', 'Wav2Lip', 'face_detection', 'detection', 'sfd', 's3fd.pth');
  checks.push({
    name: 'comfyui:model:wav2lip_gan.pth',
    ok: fs.existsSync(ganPath),
    critical: true,
    code: 'INPUT_NOT_FOUND',
    error: fs.existsSync(ganPath) ? null : 'missing wav2lip_gan.pth',
    details: { path: ganPath },
  });
  checks.push({
    name: 'comfyui:model:s3fd.pth',
    ok: fs.existsSync(s3fdPath),
    critical: true,
    code: 'INPUT_NOT_FOUND',
    error: fs.existsSync(s3fdPath) ? null : 'missing s3fd.pth',
    details: { path: s3fdPath },
  });
  return checks;
}

function extractNodeNames(objectInfo) {
  const nodes = objectInfo?.nodes || objectInfo?.data?.nodes || objectInfo?.data || {};
  return new Set(Object.keys(nodes || {}));
}

function checkTorchcodec() {
  const pythonExe = resolveComfyPython();
  // torchcodec is optional because audio I/O runs through soundfile; we do not depend on torchaudio load/save.
  try {
    const result = spawnSync(pythonExe, ['-c', 'import torchcodec'], { encoding: 'utf-8' });
    const ok = result.status === 0;
    return {
      name: 'comfyui:python:torchcodec',
      ok: true,
      critical: false,
      code: ok ? null : 'OPTIONAL_DEPENDENCY',
      warning: ok ? null : result.stderr || result.stdout || 'torchcodec import failed',
      details: { python: pythonExe, status: result.status, stdout: result.stdout, stderr: result.stderr },
    };
  } catch (err) {
    return {
      name: 'comfyui:python:torchcodec',
      ok: true,
      critical: false,
      code: 'OPTIONAL_DEPENDENCY',
      warning: err.message,
      details: { python: pythonExe },
    };
  }
}

async function checkComfyui(client, options = {}) {
  const checks = [];
  const health = await client.health();
  const healthOk = !!health?.ok;
  checks.push({
    name: 'comfyui:health',
    ok: healthOk,
    critical: true,
    code: healthOk ? null : 'COMFYUI_UNAVAILABLE',
    error: healthOk ? null : (health?.error || `status ${health?.status || 'unknown'}`),
    details: health,
  });
  if (!healthOk) {
    return checks;
  }

  const objectInfo = await client.getObjectInfo();
  const infoOk = !!objectInfo?.ok;
  const nodeNames = extractNodeNames(objectInfo);
  const requireVideoNodes = options.requireVideoNodes !== false;
  const requiredNodes = ['LoadImage', 'RepeatImageBatch', 'LoadAudio', 'SaveImage', 'VIDAX_Wav2Lip'];
  if (requireVideoNodes) {
    requiredNodes.push('VHS_LoadVideo');
  }
  const missing = requiredNodes.filter((name) => !nodeNames.has(name));
  const restartHint = missing.includes('VIDAX_Wav2Lip') ? 'ComfyUI restart required after installing custom nodes' : null;
  checks.push({
    name: 'comfyui:object_info',
    ok: infoOk && missing.length === 0,
    critical: true,
    code: infoOk && missing.length === 0 ? null : missing.length ? 'COMFYUI_MISSING_NODES' : 'COMFYUI_UNAVAILABLE',
    error: infoOk
      ? missing.length
        ? `missing nodes: ${missing.join(', ')}${restartHint ? `; ${restartHint}` : ''}`
        : null
      : objectInfo?.error || 'object_info unavailable',
    details: Object.assign({ missing, restart_required: !!restartHint, restart_hint: restartHint }, objectInfo || {}),
  });

  checks.push(...checkWav2LipWeights());
  return checks;
}

async function runDoctor(options = {}) {
  const { requirePython = false, skip_comfyui = false } = options;
  const checks = [
    checkCommand('ffmpeg'),
    checkCommand('ffprobe'),
    checkCommand('node', ['-v']),
    checkCommand('python', ['-V'], { critical: !!requirePython }),
  ];
  if (!skip_comfyui) {
    checks.push(checkTorchcodec());
    const comfyuiClient = new ComfyUIClient(options.comfyui || {});
    const comfyChecks = await checkComfyui(comfyuiClient, options);
    checks.push(...comfyChecks);
  }
  const criticalFailed = checks.filter((c) => c.critical && !c.ok);
  const failureCode = criticalFailed.find((c) => c.code)?.code || 'UNSUPPORTED_FORMAT';
  const exitCode = criticalFailed.length === 0 ? 0 : mapErrorToExitCode(failureCode);
  return { ok: criticalFailed.length === 0, checks, exitCode };
}

async function assertDoctor(options = {}) {
  const result = await runDoctor(options);
  if (!result.ok) {
    throw new AppError('VALIDATION_ERROR', 'system checks failed', { checks: result.checks }, false);
  }
  return result;
}

module.exports = { runDoctor, assertDoctor };
