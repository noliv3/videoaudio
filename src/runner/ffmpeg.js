const fs = require('fs');
const { spawnSync } = require('child_process');
const { AppError } = require('../errors');

function getFfmpegVersion() {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
  if (result.error && result.error.code === 'ENOENT') {
    return 'unknown';
  }
  if (result.status !== 0 || !result.stdout) {
    return 'unknown';
  }
  const firstLine = result.stdout.split('\n')[0] || '';
  const match = firstLine.match(/ffmpeg version\s+([^\s]+)/i);
  return (match && match[1]) || firstLine.trim() || 'unknown';
}

function ensureFfmpeg(result, context) {
  if (result.error && result.error.code === 'ENOENT') {
    throw new AppError('UNSUPPORTED_FORMAT', 'ffmpeg not available', { context });
  }
  if (result.status !== 0) {
    throw new AppError('FFMPEG_FAILED', `${context} failed`, { stderr: result.stderr, stdout: result.stdout });
  }
}

function muxAudioVideo({ videoInput, audioInput, fps, outPath, maxDurationSeconds, isImageSequence = false }) {
  if (!videoInput || !audioInput || !fps || !outPath || !maxDurationSeconds) {
    throw new AppError('FFMPEG_FAILED', 'muxAudioVideo missing required parameters', {
      videoInput,
      audioInput,
      fps,
      outPath,
      maxDurationSeconds,
    });
  }
  const frameMargin = 1 / fps;
  const trimTarget = Math.max(0, maxDurationSeconds - frameMargin);
  const durationCap = trimTarget > 0 ? trimTarget : maxDurationSeconds;
  const filters = [`fps=${fps}`, `trim=0:${durationCap}`, 'setpts=PTS-STARTPTS'];
  const args = ['-y'];
  if (isImageSequence) {
    args.push('-framerate', String(fps));
  }
  args.push('-i', videoInput, '-i', audioInput, '-filter_complex', `[0:v]${filters.join(',')}[v]`, '-map', '[v]', '-map', '1:a');
  args.push('-r', String(fps), '-vsync', 'cfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outPath);
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'mux');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'ffmpeg did not produce output', { outPath });
  }
  return outPath;
}

function createStillVideo({ imagePath, fps, durationSeconds, outPath }) {
  if (!imagePath || !fps || !durationSeconds || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'createStillVideo missing parameters', { imagePath, fps, durationSeconds, outPath });
  }
  const args = [
    '-y',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-t',
    String(durationSeconds),
    '-vf',
    `fps=${fps},format=yuv420p`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outPath,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'still_video');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'dummy video not produced', { outPath });
  }
  return outPath;
}

function extractFirstFrame({ videoInput, outPath }) {
  if (!videoInput || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'extractFirstFrame missing parameters', { videoInput, outPath });
  }
  const args = ['-y', '-ss', '0', '-i', videoInput, '-frames:v', '1', outPath];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'extract_frame');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'failed to extract frame', { outPath });
  }
  return outPath;
}

module.exports = { getFfmpegVersion, muxAudioVideo, createStillVideo, extractFirstFrame };
