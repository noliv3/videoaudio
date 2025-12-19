const fs = require('fs');
const path = require('path');
const { stateRoot } = require('../runner/paths');
const { AppError } = require('../errors');
const { assertDoctor } = require('./doctor');
const { ensureAllAssets, resolveAssetsConfigPath } = require('./assets');

function ensureStateDirs(baseDir = stateRoot) {
  const comfyRoot = path.join(baseDir, 'comfyui');
  const stateConfigDir = path.join(baseDir, 'config');
  fs.mkdirSync(path.join(comfyRoot, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(comfyRoot, 'models'), { recursive: true });
  fs.mkdirSync(stateConfigDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'runs'), { recursive: true });
  return { state_dir: baseDir, comfy_root: comfyRoot, config_dir: stateConfigDir };
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

async function runInstallFlow(options = {}) {
  const { skipDoctor = false, assetsPath, requirePython = false } = options;
  if (!skipDoctor) {
    await assertDoctor({ requirePython });
  }
  const dirs = ensureStateDirs();
  const createdConfigs = ensureConfigFiles();
  const manifestPath = assetsPath || resolveAssetsConfigPath();
  const assetsSummary = await ensureAllAssets(manifestPath, stateRoot, { install: true, strict: false });
  if (!assetsSummary.ok) {
    throw new AppError('UNSUPPORTED_FORMAT', 'asset install incomplete', { assets: assetsSummary });
  }
  return { state_dir: dirs.state_dir, comfy_root: dirs.comfy_root, created_configs: createdConfigs, assets: assetsSummary };
}

module.exports = { runInstallFlow, ensureStateDirs, ensureConfigFiles };
