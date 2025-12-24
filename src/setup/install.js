const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { stateRoot } = require('../runner/paths');
const { AppError } = require('../errors');
const { assertDoctor } = require('./doctor');
const { ensureAllAssets, resolveAssetsConfigPath, downloadTo } = require('./assets');
const { resolveCustomNodesDir, resolveComfyPython } = require('./comfyPaths');

const defaultWav2LipSources = [
  process.env.WAV2LIP_GAN_URL,
  'https://github.com/Rudrabha/Wav2Lip/releases/download/v0.1/wav2lip_gan.pth',
  'https://huggingface.co/akhaliq/Wav2Lip/resolve/main/wav2lip_gan.pth',
].filter(Boolean);

const defaultS3fdSources = [
  process.env.S3FD_MODEL_URL,
  'https://github.com/Rudrabha/Wav2Lip/releases/download/v0.1/s3fd.pth',
  'https://huggingface.co/akhaliq/Wav2Lip/resolve/main/s3fd.pth',
].filter(Boolean);

function ensureStateDirs(baseDir = stateRoot) {
  const comfyRoot = path.join(baseDir, 'comfyui');
  const bundledRoot = path.join(baseDir, 'assets');
  const stateConfigDir = path.join(baseDir, 'config');
  fs.mkdirSync(path.join(comfyRoot, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(comfyRoot, 'models'), { recursive: true });
  fs.mkdirSync(path.join(bundledRoot, 'workflows'), { recursive: true });
  fs.mkdirSync(stateConfigDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'runs'), { recursive: true });
  return { state_dir: baseDir, comfy_root: comfyRoot, config_dir: stateConfigDir, bundled_root: bundledRoot };
}

function copyIfMissing(examplePath, targetPath) {
  if (fs.existsSync(targetPath)) {
    return false;
  }
  if (!fs.existsSync(examplePath)) {
    throw new AppError('INPUT_NOT_FOUND', 'example config missing', { example: examplePath });
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(examplePath, targetPath);
  return true;
}

function ensureConfigFiles(baseDir = process.cwd()) {
  const created = [];
  const pairs = [
    { example: path.join(baseDir, 'config', 'vidax.example.json'), target: path.join(stateRoot, 'config', 'vidax.json') },
    { example: path.join(baseDir, 'config', 'lipsync.providers.example.json'), target: path.join(stateRoot, 'config', 'lipsync.providers.json') },
    { example: path.join(baseDir, 'config', 'assets.example.json'), target: path.join(stateRoot, 'config', 'assets.json') },
  ];
  pairs.forEach((pair) => {
    if (copyIfMissing(pair.example, pair.target)) {
      created.push(pair.target);
    }
  });
  return created;
}

function ensureBundledWorkflows(baseDir = process.cwd()) {
  const created = [];
  const bundles = [
    {
      example: path.join(baseDir, 'assets', 'workflows', 'vidax_text2img_frames.json'),
      target: path.join(stateRoot, 'assets', 'workflows', 'vidax_text2img_frames.json'),
    },
  ];
  bundles.forEach((pair) => {
    if (!fs.existsSync(pair.example)) {
      throw new AppError('INPUT_NOT_FOUND', 'bundled workflow missing', { example: pair.example });
    }
    fs.mkdirSync(path.dirname(pair.target), { recursive: true });
    fs.copyFileSync(pair.example, pair.target);
    created.push(pair.target);
  });
  return created;
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) {
    throw new AppError('GIT_ERROR', 'git invocation failed', { args, error: result.error.message });
  }
  if (result.status !== 0) {
    throw new AppError('GIT_ERROR', 'git command failed', { args, code: result.status, stderr: result.stderr });
  }
  return result.stdout;
}

function cloneOrUpdateRepo(repoUrl, targetDir) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  if (!fs.existsSync(targetDir)) {
    runGit(['clone', repoUrl, targetDir], parent);
    return { repo: repoUrl, path: targetDir, action: 'cloned' };
  }
  if (!fs.existsSync(path.join(targetDir, '.git'))) {
    throw new AppError('GIT_ERROR', 'target exists but is not a git repo', { path: targetDir, repo: repoUrl });
  }
  runGit(['-C', targetDir, 'pull'], targetDir);
  return { repo: repoUrl, path: targetDir, action: 'updated' };
}

function installRepoRequirements(repoPath, pythonExe) {
  const reqPath = path.join(repoPath, 'requirements.txt');
  if (!fs.existsSync(reqPath)) {
    return null;
  }
  const result = spawnSync(pythonExe, ['-m', 'pip', 'install', '-r', reqPath], { cwd: repoPath, encoding: 'utf-8' });
  if (result.error) {
    throw new AppError('PYTHON_DEPENDENCY_FAILED', 'python invocation failed', {
      repo: repoPath,
      python: pythonExe,
      error: result.error.message,
    });
  }
  if (result.status !== 0) {
    throw new AppError('PYTHON_DEPENDENCY_FAILED', 'failed to install python dependencies', {
      repo: repoPath,
      python: pythonExe,
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return { repo: repoPath, requirements: reqPath, python: pythonExe, action: 'installed' };
}

async function downloadModel(targetPath, sources) {
  if (fs.existsSync(targetPath)) {
    return { path: targetPath, action: 'present' };
  }
  const errors = [];
  for (const url of sources) {
    try {
      await downloadTo(url, targetPath);
      return { path: targetPath, action: 'downloaded', url };
    } catch (err) {
      errors.push({ url, code: err.code, message: err.message });
    }
  }
  throw new AppError('INPUT_NOT_FOUND', 'all model downloads failed', { target: targetPath, attempts: errors });
}

async function installComfyCustomNodes() {
  const customNodesDir = resolveCustomNodesDir();
  fs.mkdirSync(customNodesDir, { recursive: true });
  const repos = [
    { name: 'ComfyUI-VideoHelperSuite', url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git' },
    { name: 'ComfyUI_wav2lip', url: 'https://github.com/ShmuelRonen/ComfyUI_wav2lip.git' },
  ];
  const repoResults = repos.map((repo) => {
    const target = path.join(customNodesDir, repo.name);
    return cloneOrUpdateRepo(repo.url, target);
  });
  const pythonExe = resolveComfyPython();
  const pythonInstalls = [];
  repoResults.forEach((repo) => {
    const installResult = installRepoRequirements(repo.path, pythonExe);
    if (installResult) {
      pythonInstalls.push(installResult);
    }
  });

  const wav2lipDir = path.join(customNodesDir, 'ComfyUI_wav2lip', 'Wav2Lip');
  const ganPath = path.join(wav2lipDir, 'checkpoints', 'wav2lip_gan.pth');
  const s3fdPath = path.join(wav2lipDir, 'face_detection', 'detection', 'sfd', 's3fd.pth');
  fs.mkdirSync(path.dirname(ganPath), { recursive: true });
  fs.mkdirSync(path.dirname(s3fdPath), { recursive: true });
  const models = [
    await downloadModel(ganPath, defaultWav2LipSources),
    await downloadModel(s3fdPath, defaultS3fdSources),
  ];

  return { base_dir: customNodesDir, repos: repoResults, models, python_installs: pythonInstalls, python_executable: pythonExe };
}

async function runInstallFlow(options = {}) {
  const { skipDoctor = false, assetsPath, requirePython = false } = options;
  const installComfyNodes = parseBool(options.installComfyNodes, parseBool(process.env.VA_INSTALL_COMFY_NODES, true));
  if (!skipDoctor) {
    await assertDoctor({ requirePython, skip_comfyui: installComfyNodes === true });
  }
  const dirs = ensureStateDirs();
  const createdConfigs = ensureConfigFiles();
  const bundledWorkflows = ensureBundledWorkflows();
  const manifestPath = assetsPath || resolveAssetsConfigPath();
  const assetsSummary = await ensureAllAssets(manifestPath, stateRoot, { install: true, strict: false });
  if (!assetsSummary.ok) {
    throw new AppError('UNSUPPORTED_FORMAT', 'asset install incomplete', { assets: assetsSummary });
  }
  let comfyNodes = null;
  if (installComfyNodes) {
    comfyNodes = await installComfyCustomNodes();
    console.log('ComfyUI custom nodes installed/updated; restart ComfyUI to load changes.');
  } else {
    console.log('Skipping ComfyUI custom node install (install_comfy_nodes=false).');
  }
  return {
    state_dir: dirs.state_dir,
    comfy_root: dirs.comfy_root,
    created_configs: createdConfigs,
    bundled_workflows: bundledWorkflows,
    assets: assetsSummary,
    install_comfy_nodes: installComfyNodes,
    comfy_nodes: comfyNodes,
  };
}

module.exports = { runInstallFlow, ensureStateDirs, ensureConfigFiles };
