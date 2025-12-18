const fs = require('fs');
const { randomUUID } = require('crypto');
const validateJob = require('./validateJob');
const { buildPaths, prepareWorkdir, registerRun } = require('./paths');
const RunnerLogger = require('./logger');
const manifest = require('./manifest');

async function runJob(job, options = {}) {
  const validation = validateJob(job);
  if (!validation.valid) {
    const error = new Error('Job validation failed');
    error.details = validation;
    throw error;
  }

  const runId = options.runId || randomUUID();
  const paths = buildPaths(job, runId);
  prepareWorkdir(paths);
  registerRun(runId, paths.base);

  fs.writeFileSync(paths.job, JSON.stringify(job, null, 2));
  manifest.createDraft(paths.manifest, job, runId);
  const logger = new RunnerLogger(paths.events);
  logger.log({ level: 'info', stage: 'init', run_id: runId, message: 'job queued' });

  try {
    manifest.markStarted(paths.manifest);
    manifest.recordPhase(paths.manifest, 'prepare', 'running');
    logger.log({ level: 'info', stage: 'prepare', message: 'preparing inputs' });
    const prepareDetails = {
      audioDurationSeconds: job.input?.audio ? 0 : null,
      fps: job.determinism?.fps ?? null,
      frameRounding: job.determinism?.frame_rounding || 'ceil',
      comfyuiSeed: job.comfyui?.seed ?? null,
      hashes: {
        start: job.input?.start_image || job.input?.start_video || null,
        audio: job.input?.audio || null,
        end: job.input?.end_image || null
      }
    };
    manifest.recordPrepare(paths.manifest, prepareDetails);
    manifest.recordPhase(paths.manifest, 'prepare', 'completed');

    manifest.recordPhase(paths.manifest, 'comfyui', 'queued');
    logger.log({ level: 'info', stage: 'comfyui', message: 'comfyui placeholder' });
    manifest.recordPhase(paths.manifest, 'comfyui', 'skipped', { note: 'stubbed in stage 1' });

    manifest.recordPhase(paths.manifest, 'stabilize', 'skipped');
    manifest.recordPhase(paths.manifest, 'lipsync', 'skipped');
    manifest.recordPhase(paths.manifest, 'encode', 'queued');
    logger.log({ level: 'info', stage: 'encode', message: 'encoding placeholder' });

    if (!fs.existsSync(paths.final)) {
      fs.writeFileSync(paths.final, 'placeholder');
    }
    manifest.recordPhase(paths.manifest, 'encode', 'completed');

    manifest.markFinished(paths.manifest, 'success');
    logger.log({ level: 'info', stage: 'done', run_id: runId, message: 'job complete' });

    return { runId, status: 'success', paths };
  } catch (err) {
    manifest.markFinished(paths.manifest, 'failed');
    logger.log({ level: 'error', stage: 'error', message: err.message });
    throw err;
  }
}

module.exports = runJob;
