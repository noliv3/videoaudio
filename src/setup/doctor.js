const { spawnSync } = require('child_process');
const { AppError, mapErrorToExitCode } = require('../errors');

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

async function runDoctor(options = {}) {
  const { requirePython = false } = options;
  const checks = [
    checkCommand('ffmpeg'),
    checkCommand('ffprobe'),
    checkCommand('node', ['-v']),
    checkCommand('python', ['-V'], { critical: !!requirePython }),
  ];
  const criticalFailed = checks.filter((c) => c.critical && !c.ok);
  const exitCode = criticalFailed.length === 0 ? 0 : mapErrorToExitCode('UNSUPPORTED_FORMAT');
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
