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

function getFfprobeVersion() {
  const result = spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' });
  if (result.error && result.error.code === 'ENOENT') {
    return 'unknown';
  }
  if (result.status !== 0 || !result.stdout) {
    return 'unknown';
  }
  const firstLine = result.stdout.split('\n')[0] || '';
  const match = firstLine.match(/ffprobe version\s+([^\s]+)/i);
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

function signed(n) {
  const fixed = Number(n || 0).toFixed(6);
  return n >= 0 ? `+${fixed}` : fixed;
}

function probeMediaDurations(filePath) {
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,stream=index,codec_type,duration',
    '-of',
    'json',
    filePath,
  ], { encoding: 'utf-8' });
  if (result.error && result.error.code === 'ENOENT') {
    throw new AppError('UNSUPPORTED_FORMAT', 'ffprobe not available', { context: 'probe', file: filePath });
  }
  if (result.status !== 0) {
    throw new AppError('FFMPEG_FAILED', 'ffprobe probe failed', { stderr: result.stderr, stdout: result.stdout });
  }
  let parsed = {};
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (err) {
    throw new AppError('FFMPEG_FAILED', 'failed to parse ffprobe output', { error: err.message, output: result.stdout });
  }
  const streams = parsed.streams || [];
  const formatDuration = parsed.format && parsed.format.duration != null ? Number(parsed.format.duration) : null;
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const videoDuration =
    videoStream && videoStream.duration != null ? Number(videoStream.duration) : formatDuration != null ? formatDuration : null;
  const audioDuration =
    audioStream && audioStream.duration != null ? Number(audioStream.duration) : formatDuration != null ? formatDuration : null;
  return {
    formatDuration,
    videoDuration: Number.isFinite(videoDuration) ? videoDuration : null,
    audioDuration: Number.isFinite(audioDuration) ? audioDuration : null,
  };
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
  const targetDurationSeconds = maxDurationSeconds;
  const filters = [];
  if (targetWidth && targetHeight) {
    filters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
  }
  filters.push(`fps=${fps}`);
  if (holdSeconds && holdSeconds > 0) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${holdSeconds}`);
  }
  filters.push(`trim=0:${targetDurationSeconds}`, 'setpts=PTS-STARTPTS');
  const args = ['-y'];
  if (isImageSequence) {
    args.push('-framerate', String(fps));
  }
  args.push('-i', videoInput, '-i', audioInput, '-filter_complex', `[0:v]${filters.join(',')}[v]`, '-map', '[v]', '-map', '1:a');
  args.push(
    '-r',
    String(fps),
    '-vsync',
    'cfr',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    String(targetDurationSeconds),
    '-movflags',
    '+faststart',
    outPath
  );
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'mux');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'ffmpeg did not produce output', { outPath });
  }
  const probe = probeMediaDurations(outPath);
  const tolerance = 1 / Number(fps);
  const videoDrift = Number.isFinite(targetDurationSeconds) && Number.isFinite(tolerance) && probe.videoDuration != null
    ? Math.abs(probe.videoDuration - targetDurationSeconds)
    : Infinity;
  const audioDrift = Number.isFinite(targetDurationSeconds) && Number.isFinite(tolerance) && probe.audioDuration != null
    ? Math.abs(probe.audioDuration - targetDurationSeconds)
    : Infinity;
  if (videoDrift > tolerance || audioDrift > tolerance) {
    throw new AppError('FFMPEG_FAILED', 'muxed output duration drift exceeded tolerance', {
      target_duration: targetDurationSeconds,
      fps,
      video_duration: probe.videoDuration,
      audio_duration: probe.audioDuration,
      tolerance,
    });
  }
  const roundedFrames = Number.isFinite(probe.videoDuration) && Number.isFinite(fps)
    ? Math.round(probe.videoDuration * fps)
    : null;
  if (roundedFrames != null && roundedFrames <= 1) {
    throw new AppError('FFMPEG_FAILED', 'muxed output contains one or fewer frames', {
      fps,
      video_duration: probe.videoDuration,
      target_duration: targetDurationSeconds,
    });
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

function createMotionVideoFromImage({
  imagePath,
  fps,
  durationSeconds,
  outPath,
  targetWidth,
  targetHeight,
  seed,
}) {
  if (!imagePath || !fps || !durationSeconds || !outPath) {
    throw new AppError('FFMPEG_FAILED', 'createMotionVideoFromImage missing parameters', {
      imagePath,
      fps,
      durationSeconds,
      outPath,
    });
  }
  const { filter } = buildMotionFilterSpec({ fps, durationSeconds, targetWidth, targetHeight, seed });
  const args = [
    '-y',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
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
  ensureFfmpeg(result, 'motion_video');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'motion_video output missing', { outPath });
  }
  return outPath;
}

function buildMotionFilterSpec({ fps, durationSeconds, targetWidth, targetHeight, seed }) {
  const frames = Math.max(2, Math.ceil(durationSeconds * fps));
  const denom = Math.max(1, frames - 1);
  const seedValue = Number.isFinite(Number(seed)) ? Number(seed) : 0;
  const phase = (offset) => {
    const value = Math.sin(seedValue + offset) * 10000;
    return value - Math.floor(value);
  };
  const zoomDirection = phase(1) > 0.5 ? 1 : -1;
  const startZoom = 1 + 0.02 + phase(2) * 0.03;
  const targetZoom = startZoom + zoomDirection * (0.04 + phase(3) * 0.06);
  const panRangeX = (phase(4) - 0.5) * 0.12;
  const panRangeY = (phase(5) - 0.5) * 0.12;
  const zoomDiff = targetZoom - startZoom;
  const zExpr = `${startZoom.toFixed(6)}+(${zoomDiff.toFixed(6)})*on/${denom}`;
  const xExpr = `max(min(iw-(iw/zoom),iw/2-(iw/zoom)/2${signed(panRangeX)}*iw*on/${denom}),0)`;
  const yExpr = `max(min(ih-(ih/zoom),ih/2-(ih/zoom)/2${signed(panRangeY)}*ih*on/${denom}),0)`;
  const sizeExpr = targetWidth && targetHeight ? `${targetWidth}x${targetHeight}` : 'iw:ih';
  const preScale =
    targetWidth && targetHeight ? `scale=${targetWidth}:${targetHeight}:flags=lanczos,crop=${targetWidth}:${targetHeight}` : null;
  const filterParts = ['format=rgba'];
  if (preScale) {
    filterParts.push(preScale);
  }
  filterParts.push(`zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${sizeExpr}:fps=${fps}`, 'format=yuv420p');
  const filter = `[0:v]${filterParts.join(',')}[v]`;
  return { filter, frames };
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

function concatVideos(videoPaths, outPath, { fps, targetWidth, targetHeight } = {}) {
  if (!Array.isArray(videoPaths) || videoPaths.length === 0 || !outPath || !fps) {
    throw new AppError('FFMPEG_FAILED', 'concatVideos missing parameters', { videoPaths, outPath, fps });
  }
  const inputs = videoPaths.flatMap((videoPath) => ['-i', videoPath]);
  const filterParts = videoPaths.map((_, idx) => {
    const scaleFilter = targetWidth && targetHeight ? `scale=${targetWidth}:${targetHeight}:flags=lanczos,` : '';
    return `[${idx}:v]${scaleFilter}fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${idx}]`;
  });
  const concatFilter =
    filterParts.join(';') +
    `;${videoPaths
      .map((_, idx) => `[v${idx}]`)
      .join('')}concat=n=${videoPaths.length}:v=1:a=0[v]`;
  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    concatFilter,
    '-map',
    '[v]',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outPath,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
  ensureFfmpeg(result, 'concat');
  if (!fs.existsSync(outPath)) {
    throw new AppError('FFMPEG_FAILED', 'concat output missing', { outPath });
  }
  return outPath;
}

module.exports = {
  getFfmpegVersion,
  getFfprobeVersion,
  muxAudioVideo,
  probeMediaDurations,
  createStillVideo,
  createMotionVideoFromImage,
  extractFirstFrame,
  padAudio,
  createVideoFromFrames,
  concatVideos,
  buildMotionFilterSpec,
};
