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

function muxAudioVideo({
  videoInput,
  audioInput,
  fps,
  outPath,
  maxDurationSeconds,
  isImageSequence = false,
  holdSeconds = 0,
  targetWidth,
  targetHeight,
}) {
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
  const filters = [];
  if (targetWidth && targetHeight) {
    filters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
  }
  filters.push(`fps=${fps}`);
  if (holdSeconds && holdSeconds > 0) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${holdSeconds}`);
  }
  filters.push(`trim=0:${durationCap}`, 'setpts=PTS-STARTPTS');
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

function createStillVideo({ imagePath, fps, durationSeconds, outPath, targetWidth, targetHeight }) {
  if (!imagePath || !fps || !durationSeconds || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'createStillVideo missing parameters', {
      imagePath,
      fps,
      durationSeconds,
      outPath,
    });
  }
  const filters = [];
  if (targetWidth && targetHeight) {
    filters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
  }
  filters.push('format=yuv420p', `fps=${fps}`);
  const args = [
    '-y',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-t',
    String(durationSeconds),
    '-vf',
    filters.join(','),
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

function padAudio({ audioInput, preSeconds = 0, postSeconds = 0, targetDurationSeconds, outPath }) {
  if (!audioInput || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'padAudio missing parameters', { audioInput, outPath });
  }
  if ((preSeconds ?? 0) <= 0 && (postSeconds ?? 0) <= 0) {
    return audioInput;
  }
  const duration = targetDurationSeconds ? String(targetDurationSeconds) : null;
  const delayMs = Math.max(0, Math.round((preSeconds || 0) * 1000));
  const filters = [`adelay=${delayMs}|${delayMs}`, 'apad'];
  const args = ['-y', '-i', audioInput, '-filter_complex', `[0:a]${filters.join(',')}[a]`, '-map', '[a]', '-c:a', 'aac'];
  if (duration) {
    args.push('-t', duration);
  }
  args.push(outPath);
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'audio_pad');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'padded audio not produced', { outPath });
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

function createVideoFromFrames({ framesPattern, fps, outPath, targetWidth, targetHeight }) {
  if (!framesPattern || !fps || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'createVideoFromFrames missing parameters', { framesPattern, fps, outPath });
  }
  const useGlob = framesPattern.includes('*');
  const filters = [];
  if (targetWidth && targetHeight) {
    filters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
  }
  const filterArgs = filters.length ? ['-vf', filters.join(',')] : [];
  const args = [
    '-y',
    '-framerate',
    String(fps),
    ...(useGlob ? ['-pattern_type', 'glob'] : []),
    '-i',
    framesPattern,
    ...filterArgs,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-movflags',
    '+faststart',
    outPath,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'frames_to_video');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'failed to render frames video', { outPath });
  }
  return outPath;
}

function concatVideos(videoPaths, outPath) {
  if (!Array.isArray(videoPaths) || videoPaths.length === 0 || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'concatVideos missing parameters', { videoPaths, outPath });
  }
  const listPath = `${outPath}.txt`;
  const content = videoPaths.map((p) => `file '${p.replace(/'/g, "'\''")}'`).join('\n');
  fs.writeFileSync(listPath, content, 'utf-8');
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'concat');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'concat output missing', { outPath });
  }
  return outPath;
}

module.exports = { getFfmpegVersion, muxAudioVideo, createStillVideo, extractFirstFrame, padAudio, createVideoFromFrames, concatVideos };
