const fs = require('fs');
const path = require('path');
const { stateDir } = require('../runner/paths');
const { AppError } = require('../errors');
const { assertDoctor } = require('./doctor');
const { ensureAllAssets, resolveAssetsConfigPath } = require('./assets');

function ensureStateDirs(baseDir = stateDir) {
  const comfyRoot = path.join(baseDir, 'comfyui');
  fs.mkdirSync(path.join(comfyRoot, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(comfyRoot, 'models'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'runs'), { recursive: true });
  return { state_dir: baseDir, comfy_root: comfyRoot };
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

function ensureConfigFiles() {
  const created = [];
  const pairs = [
    { example: path.join(process.cwd(), 'config', 'vidax.example.json'), target: path.join(process.cwd(), 'config', 'vidax.json') },
    { example: path.join(process.cwd(), 'config', 'lipsync.providers.example.json'), target: path.join(process.cwd(), 'config', 'lipsync.providers.json') },
    { example: path.join(process.cwd(), 'config', 'assets.example.json'), target: resolveAssetsConfigPath() },
  ];
  pairs.forEach((pair) => {
    if (copyIfMissing(pair.example, pair.target)) {
      created.push(pair.target);
    }
  });
  return created;
}

async function runInstallFlow(options = {}) {
  const { skipDoctor = false, assetsPath = resolveAssetsConfigPath(), requirePython = false } = options;
  if (!skipDoctor) {
    await assertDoctor({ requirePython });
  }
  const dirs = ensureStateDirs();
  const createdConfigs = ensureConfigFiles();
  const assetsSummary = await ensureAllAssets(assetsPath, stateDir, { install: true, strict: false });
  if (!assetsSummary.ok) {
    throw new AppError('VALIDATION_ERROR', 'asset install incomplete', { assets: assetsSummary });
  }
  return { state_dir: dirs.state_dir, comfy_root: dirs.comfy_root, created_configs: createdConfigs, assets: assetsSummary };
}

module.exports = { runInstallFlow, ensureStateDirs, ensureConfigFiles };
