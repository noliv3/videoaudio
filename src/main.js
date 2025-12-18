#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const runJob = require('./runner/runJob');
const validateJob = require('./runner/validateJob');
const { resolveRun } = require('./runner/paths');
const manifest = require('./runner/manifest');
const { AppError, mapErrorToExitCode } = require('./errors');

function loadJob(file) {
  const content = fs.readFileSync(file, 'utf-8');
  return JSON.parse(content);
}

function withWorkdirOverride(job, workdir) {
  if (!workdir) return job;
  return {
    ...job,
    output: { ...(job.output || {}), workdir },
  };
}

function exitWithError(err) {
  const code = mapErrorToExitCode(err.code);
  console.error(err.message);
  if (err.details?.errors) {
    err.details.errors.forEach((e) => console.error(`${e.code || err.code}: ${e.field} -> ${e.message}`));
  }
  process.exit(code);
}

yargs(hideBin(process.argv))
  .command('validate <job>', 'validate job.json', (y) => y.positional('job', { type: 'string' }), (args) => {
    const job = loadJob(args.job);
    const result = validateJob(job);
    if (result.valid) {
      console.log('VALID');
      process.exit(0);
    }
    const err = new AppError('VALIDATION_ERROR', 'Job validation failed', { errors: result.errors });
    exitWithError(err);
  })
  .command('run <job>', 'run job locally', (y) => y
    .positional('job', { type: 'string' })
    .option('workdir', { type: 'string' })
    .option('resume', { type: 'boolean', default: false }),
  async (args) => {
    try {
      const job = withWorkdirOverride(loadJob(args.job), args.workdir);
      const result = await runJob(job, { resume: args.resume });
      console.log(`RUN ${result.runId}`);
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError(err.code || 'UNKNOWN_ERROR', err.message, err.details);
      exitWithError(wrapped);
    }
  })
  .command('status <run_id>', 'show run status', (y) => y.positional('run_id', { type: 'string' }), (args) => {
    const run = resolveRun(args.run_id);
    if (!run) {
      console.error('run not found');
      process.exit(1);
    }
    const mPath = path.join(run.workdir, 'manifest.json');
    const data = manifest.readManifest(mPath);
    if (!data) {
      console.error('manifest missing');
      process.exit(1);
    }
    console.log(JSON.stringify({ run_id: args.run_id, status: data.run_status || data.status, exit_status: data.exit_status, phases: data.phases || {} }, null, 2));
  })
  .command('logs <run_id>', 'print run logs', (y) => y.positional('run_id', { type: 'string' }), (args) => {
    const run = resolveRun(args.run_id);
    if (!run) {
      console.error('run not found');
      process.exit(1);
    }
    const eventsPath = path.join(run.workdir, 'logs', 'events.jsonl');
    if (!fs.existsSync(eventsPath)) {
      console.error('events log missing');
      process.exit(1);
    }
    const content = fs.readFileSync(eventsPath, 'utf-8');
    console.log(content.trim());
  })
  .demandCommand(1)
  .strict()
  .help()
  .parse();
