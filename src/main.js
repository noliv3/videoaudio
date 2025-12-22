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
const { runInstallFlow } = require('./setup/install');
const { runDoctor } = require('./setup/doctor');
const { buildProduceJob } = require('./runner/produce');

function loadJob(file) {
  if (!fs.existsSync(file)) {
    throw new AppError('INPUT_NOT_FOUND', `job file not found: ${file}`);
  }
  try {
    const content = fs.readFileSync(file, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', 'invalid job json', { path: file, error: err.message });
  }
}

function withWorkdirOverride(job, workdir) {
  if (!workdir) return job;
  const clone = Object.assign({}, job);
  const output = Object.assign({}, job.output || {}, { workdir });
  clone.output = output;
  return clone;
}

function exitWithError(err) {
  const wrapped = err instanceof AppError ? err : new AppError(err.code || 'UNKNOWN_ERROR', err.message, err.details);
  const code = mapErrorToExitCode(wrapped.code);
  console.error(wrapped.message);
  if (wrapped.details && wrapped.details.errors) {
    wrapped.details.errors.forEach((e) => {
      console.error(`${e.code || wrapped.code}: ${e.field} -> ${e.message}`);
    });
  }
  process.exit(code);
}

yargs(hideBin(process.argv))
  .command('validate <job>', 'validate job.json', (y) => y.positional('job', { type: 'string' }), (args) => {
    try {
      const job = loadJob(args.job);
      const result = validateJob(job);
      if (result.valid) {
        console.log('VALID');
        process.exit(0);
      }
      const err = new AppError('VALIDATION_ERROR', 'Job validation failed', { errors: result.errors });
      exitWithError(err);
    } catch (err) {
      exitWithError(err);
    }
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
      exitWithError(err);
    }
  })
  .command(
    'produce',
    'build and run a job from CLI flags',
    (y) =>
      y
        .option('audio', { type: 'string', demandOption: true, describe: 'audio file (master)' })
        .option('start', { type: 'string', demandOption: true, describe: 'start image or video' })
        .option('end', { type: 'string', describe: 'optional end image' })
        .option('pre', { type: 'number', default: 0, describe: 'seconds of pre-roll visuals' })
        .option('post', { type: 'number', default: 0, describe: 'seconds of post-roll visuals' })
        .option('fps', { type: 'number', default: 25, describe: 'target fps' })
        .option('prompt', { type: 'string', demandOption: true, describe: 'prompt for render' })
        .option('neg', { type: 'string', describe: 'negative prompt' })
        .option('width', { type: 'number', describe: 'render width' })
        .option('height', { type: 'number', describe: 'render height' })
        .option('seed_policy', { choices: ['fixed', 'random', 'per_retry'], default: 'fixed' })
        .option('seed', { type: 'number', describe: 'seed (when allowed by policy)' })
        .option('lipsync', { choices: ['on', 'off'], default: 'on' })
        .option('lipsync_provider', { type: 'string', describe: 'lip sync provider id' })
        .option('workdir', { type: 'string', describe: 'output workdir' })
        .option('comfyui_url', { type: 'string', describe: 'ComfyUI server URL' }),
    async (args) => {
      try {
        const job = buildProduceJob(
          {
            audio: args.audio,
            start: args.start,
            end: args.end,
            pre: args.pre,
            post: args.post,
            fps: args.fps,
            prompt: args.prompt,
            negative: args.neg,
            width: args.width,
            height: args.height,
            seed_policy: args.seed_policy,
            seed: args.seed,
            lipsync: args.lipsync === 'on' ? true : 'off',
            lipsync_provider: args.lipsync_provider,
            workdir: args.workdir,
            comfyui_url: args.comfyui_url,
          },
          {}
        );
        const result = await runJob(job, { resume: false });
        console.log(`RUN ${result.runId}`);
      } catch (err) {
        exitWithError(err);
      }
    }
  )
  .command('status <run_id>', 'show run status', (y) => y.positional('run_id', { type: 'string' }), (args) => {
    try {
      const run = resolveRun(args.run_id);
      if (!run) {
        throw new AppError('INPUT_NOT_FOUND', 'run not found', { run_id: args.run_id });
      }
      const mPath = path.join(run.workdir, 'manifest.json');
      const data = manifest.readManifest(mPath);
      if (!data) {
        throw new AppError('INPUT_NOT_FOUND', 'manifest missing', { manifest: mPath });
      }
      const summary = {
        run_id: args.run_id,
        status: data.run_status || data.status,
        exit_status: data.exit_status,
        phases: data.phases || {},
      };
      console.log(JSON.stringify(summary, null, 2));
    } catch (err) {
      exitWithError(err);
    }
  })
  .command('logs <run_id>', 'print run logs', (y) => y.positional('run_id', { type: 'string' }), (args) => {
    try {
      const run = resolveRun(args.run_id);
      if (!run) {
        throw new AppError('INPUT_NOT_FOUND', 'run not found', { run_id: args.run_id });
      }
      const eventsPath = path.join(run.workdir, 'logs', 'events.jsonl');
      if (!fs.existsSync(eventsPath)) {
        throw new AppError('INPUT_NOT_FOUND', 'events log missing', { log: eventsPath });
      }
      const content = fs.readFileSync(eventsPath, 'utf-8');
      console.log(content.trim());
    } catch (err) {
      exitWithError(err);
    }
  })
  .command('doctor', 'check required system dependencies', () => {}, async () => {
    try {
      const result = await runDoctor({});
      result.checks.forEach((c) => {
        const label = c.ok ? 'ok' : 'missing';
        const reason = c.ok ? '' : (c.error ? `: ${c.error}` : '');
        console.log(`${label} ${c.name}${c.version ? ` (${c.version})` : ''}${reason}`);
      });
      if (!result.ok) {
        process.exit(mapErrorToExitCode('UNSUPPORTED_FORMAT'));
      }
      process.exit(0);
    } catch (err) {
      exitWithError(err);
    }
  })
  .command('install', 'install configs and assets', (y) => y.option('skip-doctor', { type: 'boolean', default: false }), async (args) => {
    try {
      const result = await runInstallFlow({ skipDoctor: args.skipDoctor });
      console.log(`State dir: ${result.state_dir}`);
      console.log(`ComfyUI dir: ${result.comfy_root}`);
      if (result.created_configs.length) {
        console.log(`Created configs: ${result.created_configs.join(', ')}`);
      }
      console.log(`Assets manifest: ${result.assets.manifest}`);
      console.log(`Assets OK: ${result.assets.ok}`);
    } catch (err) {
      exitWithError(err);
    }
  })
  .demandCommand(1)
  .strict()
  .help()
  .parse();
