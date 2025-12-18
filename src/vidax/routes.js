const express = require('express');
const fs = require('fs');
const { randomUUID } = require('crypto');
const validateJob = require('../runner/validateJob');
const runJob = require('../runner/runJob');
const { buildPaths, prepareWorkdir, registerRun, resolveRun } = require('../runner/paths');
const manifest = require('../runner/manifest');
const RunnerLogger = require('../runner/logger');

function createRouter(config) {
  const router = express.Router();
  const jobs = new Map();

  router.post('/jobs', (req, res) => {
    const job = req.body;
    const validation = validateJob(job);
    if (!validation.valid) {
      return res.status(400).json({ error: 'validation_failed', details: validation });
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
  });

  router.get('/jobs/:id', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'not_found' });
    }
    const mPath = (run.paths && run.paths.manifest) || (run.workdir && `${run.workdir}/manifest.json`);
    const data = manifest.readManifest(mPath);
    if (!data) {
      return res.status(404).json({ error: 'manifest_missing' });
    }
    res.json({ run_id: req.params.id, status: data.exit_status, phases: data.phases || {}, manifest: mPath });
  });

  router.get('/jobs/:id/manifest', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'not_found' });
    }
    const mPath = (run.paths && run.paths.manifest) || (run.workdir && `${run.workdir}/manifest.json`);
    if (!mPath || !fs.existsSync(mPath)) {
      return res.status(404).json({ error: 'manifest_missing' });
    }
    res.sendFile(mPath);
  });

  router.get('/jobs/:id/logs', (req, res) => {
    const run = resolveRun(req.params.id) || jobs.get(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'not_found' });
    }
    const eventsPath = (run.paths && run.paths.events) || (run.workdir && `${run.workdir}/logs/events.jsonl`);
    if (!eventsPath || !fs.existsSync(eventsPath)) {
      return res.status(404).json({ error: 'logs_missing' });
    }
    const content = fs.readFileSync(eventsPath, 'utf-8');
    res.type('text/plain').send(content);
  });

  router.post('/jobs/:id/start', async (req, res) => {
    const record = jobs.get(req.params.id) || resolveRun(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'not_found' });
    }
    const job = record.job || loadJobFromDisk(record.workdir);
    if (!job) {
      return res.status(404).json({ error: 'job_missing' });
    }
    res.status(202).json({ run_id: req.params.id, status: 'started' });
    try {
      await runJob(job, { runId: req.params.id });
    } catch (err) {
      // errors already captured in manifest
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
