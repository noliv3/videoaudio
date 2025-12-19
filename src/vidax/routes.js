const express = require('express');
const fs = require('fs');
const { randomUUID } = require('crypto');
const validateJob = require('../runner/validateJob');
const runJob = require('../runner/runJob');
const { buildPaths, prepareWorkdir, registerRun, resolveRun, stateRoot } = require('../runner/paths');
const manifest = require('../runner/manifest');
const RunnerLogger = require('../runner/logger');
const { AppError, errorResponse } = require('../errors');
const { ensureAllAssets, resolveAssetsConfigPath } = require('../setup/assets');

function mapHttpStatus(code) {
  switch (code) {
    case 'AUTH_CONFIGURATION':
    case 'AUTH_MISSING':
      return 401;
    case 'AUTH_FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    case 'INPUT_NOT_FOUND':
      return 404;
    case 'UNSUPPORTED_FORMAT':
      return 415;
    case 'COMFYUI_TIMEOUT':
    case 'COMFYUI_BAD_RESPONSE':
    case 'LIPSYNC_FAILED':
    case 'COMFYUI_UNAVAILABLE':
      return 424;
    case 'FFMPEG_FAILED':
    case 'OUTPUT_WRITE_FAILED':
      return 500;
    default:
      return 500;
  }
}

function handleError(res, err) {
  const status = mapHttpStatus(err.code);
  res.status(status).json(errorResponse(err));
}

function createRouter(config, deps = {}) {
  const { processManager, comfyuiClient } = deps;
  const router = express.Router();
  const jobs = new Map();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/install/status', async (_req, res) => {
    try {
      const manifestPath = config.assets_config || resolveAssetsConfigPath();
      const assetsStatus = await ensureAllAssets(manifestPath, config.state_dir || stateRoot, { install: false, strict: false });
      res.json({ ok: assetsStatus.ok, assets: assetsStatus });
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'VALIDATION_ERROR', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  router.post('/install', async (_req, res) => {
    try {
      const manifestPath = config.assets_config || resolveAssetsConfigPath();
      const assetsStatus = await ensureAllAssets(manifestPath, config.state_dir || stateRoot, { install: true, strict: false });
      if (!assetsStatus.ok) {
        throw new AppError('UNSUPPORTED_FORMAT', 'asset install incomplete', { assets: assetsStatus });
      }
      res.json({ ok: true, assets: assetsStatus });
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'VALIDATION_ERROR', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  router.get('/comfyui/health', async (_req, res) => {
    try {
      if (!comfyuiClient) {
        throw new AppError('COMFYUI_BAD_RESPONSE', 'comfyui client missing');
      }
      const status = await comfyuiClient.health();
      res.json(status);
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'COMFYUI_BAD_RESPONSE', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  router.post('/comfyui/start', async (_req, res) => {
    try {
      if (!processManager) {
        throw new AppError('COMFYUI_BAD_RESPONSE', 'comfyui process manager missing');
      }
      const result = await processManager.ensureComfyUI();
      res.status(202).json({ ok: true, status: result.status, url: result.url });
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'COMFYUI_BAD_RESPONSE', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  router.post('/jobs', (req, res) => {
    try {
      const job = req.body;
      const validation = validateJob(job);
      if (!validation.valid) {
        throw new AppError('VALIDATION_ERROR', 'Job validation failed', { errors: validation.errors });
      }
      const runId = randomUUID();
      const paths = buildPaths(job, runId);
      prepareWorkdir(paths);
      registerRun(runId, paths.base);
      fs.writeFileSync(paths.job, JSON.stringify(job, null, 2));
      manifest.createDraft(paths.manifest, job, runId);
      const logger = new RunnerLogger(paths.events);
      logger.log({ level: 'info', stage: 'init', run_id: runId, message: 'job accepted' });
      jobs.set(runId, { job, paths, status: 'queued' });
      res.status(202).json({ run_id: runId, status: 'queued', manifest: paths.manifest, workdir: paths.base });
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'UNKNOWN_ERROR', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  router.get('/jobs/:id', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'run not found')));
    }
    const mPath = (run.paths && run.paths.manifest) || (run.workdir && `${run.workdir}/manifest.json`);
    const data = manifest.readManifest(mPath);
    if (!data) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'manifest missing')));
    }
    res.json({ run_id: req.params.id, status: data.run_status || data.status, exit_status: data.exit_status, phases: data.phases || {}, manifest: mPath });
  });

  router.get('/jobs/:id/manifest', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'run not found')));
    }
    const mPath = (run.paths && run.paths.manifest) || (run.workdir && `${run.workdir}/manifest.json`);
    if (!mPath || !fs.existsSync(mPath)) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'manifest missing')));
    }
    res.sendFile(mPath);
  });

  router.get('/jobs/:id/logs', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'run not found')));
    }
    const eventsPath = (run.paths && run.paths.events) || (run.workdir && `${run.workdir}/logs/events.jsonl`);
    if (!eventsPath || !fs.existsSync(eventsPath)) {
      return res.status(404).json(errorResponse(new AppError('INPUT_NOT_FOUND', 'logs missing')));
    }
    const content = fs.readFileSync(eventsPath, 'utf-8');
    res.type('text/plain').send(content);
  });

  router.post('/jobs/:id/start', async (req, res) => {
    try {
      const record = jobs.get(req.params.id) || resolveRun(req.params.id);
      if (!record) {
        throw new AppError('INPUT_NOT_FOUND', 'run not found');
      }
      const job = record.job || loadJobFromDisk(record.workdir);
      if (!job) {
        throw new AppError('INPUT_NOT_FOUND', 'job_missing');
      }
      const resume = req.query.resume === '1' || req.query.resume === 'true';
      const paths = record.paths || buildPaths(job, req.params.id);
      const manifestExists = fs.existsSync(paths.manifest);
      const finalExists = fs.existsSync(paths.final);
      if (resume && !manifestExists) {
        throw new AppError('OUTPUT_WRITE_FAILED', 'resume requires existing manifest', { manifest: paths.manifest });
      }
      if (resume && finalExists) {
        throw new AppError('OUTPUT_WRITE_FAILED', 'cannot resume when final output already exists', { final: paths.final });
      }
      if (!resume && finalExists) {
        throw new AppError('OUTPUT_WRITE_FAILED', 'final output already exists; use resume flag', { final: paths.final });
      }
      if (!processManager) {
        throw new AppError('COMFYUI_UNAVAILABLE', 'comfyui process manager missing');
      }
      await processManager.ensureComfyUI();
      res.status(202).json({ run_id: req.params.id, status: 'started', resume });
      runJob(job, { runId: req.params.id, resume, vidax: { comfyuiClient, processManager } }).catch(() => {});
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'UNKNOWN_ERROR', err.message, err.details);
      handleError(res, wrapped);
    }
  });

  return router;
}

function loadJobFromDisk(workdir) {
  if (!workdir) return null;
  const jobPath = `${workdir}/job.json`;
  if (!fs.existsSync(jobPath)) return null;
  try {
    const raw = fs.readFileSync(jobPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

module.exports = createRouter;
