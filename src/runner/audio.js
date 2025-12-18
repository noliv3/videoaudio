const fs = require('fs');
const { spawnSync } = require('child_process');
const { AppError } = require('../errors');

function getAudioDurationSeconds(filePath) {
  if (!filePath) {
    throw new AppError('VALIDATION_ERROR', 'audio path missing');
  }
  if (!fs.existsSync(filePath)) {
    throw new AppError('INPUT_NOT_FOUND', `audio not found: ${filePath}`);
  }
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf-8' });

  if (result.error && result.error.code === 'ENOENT') {
    throw new AppError('UNSUPPORTED_FORMAT', 'ffprobe not available', { path: filePath });
  }
  if (result.status !== 0 || !result.stdout) {
    throw new AppError('UNSUPPORTED_FORMAT', 'unable to read audio duration', { path: filePath, stderr: result.stderr });
  }

  const duration = parseFloat(result.stdout.trim());
  if (Number.isNaN(duration) || duration <= 0) {
    throw new AppError('UNSUPPORTED_FORMAT', 'invalid audio duration', { path: filePath, value: result.stdout });
  }
  return duration;
}

module.exports = { getAudioDurationSeconds };
