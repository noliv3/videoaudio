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
  'https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth',
  'https://huggingface.co/akhaliq/Wav2Lip/resolve/main/wav2lip_gan.pth',
].filter(Boolean);

const defaultS3fdSources = [
  process.env.S3FD_MODEL_URL,
  'https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/s3fd-619a316812.pth',
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

function describeConfigStatus(baseDir = process.cwd()) {
  const pairs = [
    { example: path.join(baseDir, 'config', 'vidax.example.json'), target: path.join(stateRoot, 'config', 'vidax.json') },
    { example: path.join(baseDir, 'config', 'lipsync.providers.example.json'), target: path.join(stateRoot, 'config', 'lipsync.providers.json') },
    { example: path.join(baseDir, 'config', 'assets.example.json'), target: path.join(stateRoot, 'config', 'assets.json') },
  ];
  return pairs.map((pair) => ({
    example: pair.example,
    target: pair.target,
    example_exists: fs.existsSync(pair.example),
    present: fs.existsSync(pair.target),
  }));
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

function installComfyAudioDependencies(pythonExe) {
  const packages = ['imageio-ffmpeg', 'soundfile'];
  const result = spawnSync(pythonExe, ['-m', 'pip', 'install', '-U', ...packages], { encoding: 'utf-8' });
  if (result.error) {
    throw new AppError('PYTHON_DEPENDENCY_FAILED', 'python invocation failed', {
      python: pythonExe,
      error: result.error.message,
      packages,
    });
  }
  if (result.status !== 0) {
    throw new AppError('PYTHON_DEPENDENCY_FAILED', 'failed to install python dependencies', {
      python: pythonExe,
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      packages,
    });
  }
  return { python: pythonExe, packages, action: 'installed' };
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
  if (!process.env.COMFYUI_DIR) {
    throw new AppError('INPUT_NOT_FOUND', 'COMFYUI_DIR is required to install custom nodes', { env: 'COMFYUI_DIR' });
  }
  const customNodesDir = resolveCustomNodesDir();
  fs.mkdirSync(customNodesDir, { recursive: true });
  const vidaxNodeSource = path.join(process.cwd(), 'comfyui', 'custom_nodes', 'vidax_wav2lip');
  const vidaxNodeTarget = path.join(customNodesDir, 'vidax_wav2lip');
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

  if (!fs.existsSync(vidaxNodeSource)) {
    throw new AppError('INPUT_NOT_FOUND', 'vidax_wav2lip node sources missing', { source: vidaxNodeSource });
  }
  fs.rmSync(vidaxNodeTarget, { recursive: true, force: true });
  fs.cpSync(vidaxNodeSource, vidaxNodeTarget, { recursive: true });
  const vidaxNode = { source: vidaxNodeSource, target: vidaxNodeTarget, action: 'copied' };
  console.log(`installed custom node vidax_wav2lip -> ${vidaxNodeTarget}`);

  return {
    base_dir: customNodesDir,
    repos: repoResults,
    models,
    python_installs: pythonInstalls,
    python_executable: pythonExe,
    vidax_node: vidaxNode,
  };
}

async function runInstallFlow(options = {}) {
  const { skipDoctor = false, assetsPath, requirePython = false } = options;
  const installComfyNodes = parseBool(options.installComfyNodes, parseBool(process.env.VA_INSTALL_COMFY_NODES, true));
  if (!skipDoctor) {
    await assertDoctor({ requirePython, skip_comfyui: installComfyNodes === true });
  }
  const dirs = ensureStateDirs();
  const createdConfigs = ensureConfigFiles();
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
  const comfyPython = comfyNodes?.python_executable || resolveComfyPython();
  const pythonDependencies = installComfyAudioDependencies(comfyPython);
  return {
    state_dir: dirs.state_dir,
    comfy_root: dirs.comfy_root,
    created_configs: createdConfigs,
    assets: assetsSummary,
    install_comfy_nodes: installComfyNodes,
    comfy_nodes: comfyNodes,
    comfy_python: comfyPython,
    python_dependencies: pythonDependencies,
  };
}

async function runInstallTest(options = {}) {
  const { skipDoctor = false, assetsPath, requirePython = false } = options;
  const installComfyNodes = parseBool(options.installComfyNodes, parseBool(process.env.VA_INSTALL_COMFY_NODES, true));
  if (!skipDoctor) {
    await assertDoctor({ requirePython, skip_comfyui: installComfyNodes === true });
  }
  const configStatus = describeConfigStatus();
  const manifestPath = assetsPath || resolveAssetsConfigPath();
  const assetsSummary = await ensureAllAssets(manifestPath, stateRoot, { install: false, strict: false });
  const configsOk = configStatus.every((c) => c.present || !c.example_exists);
  const ok = configsOk && assetsSummary.ok;
  const result = {
    ok,
    state_dir: stateRoot,
    config_status: configStatus,
    assets: assetsSummary,
    install_comfy_nodes: installComfyNodes,
  };
  if (!ok) {
    throw new AppError('UNSUPPORTED_FORMAT', 'install test failed; run full install', result);
  }
  return result;
}

module.exports = { runInstallFlow, ensureStateDirs, ensureConfigFiles, runInstallTest };
