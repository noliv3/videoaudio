const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const createRouter = require('./routes');
const createAuthMiddleware = require('./auth');
const ProcessManager = require('./processManager');
const ComfyUIClient = require('./comfyuiClient');
const { AppError } = require('../errors');
const { stateRoot } = require('../runner/paths');
const { resolveAssetsConfigPath } = require('../setup/assets');

function expandPath(p) {
  if (!p) return null;
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(p);
}

function loadConfig() {
  const candidateStateConfig = path.join(stateRoot, 'config', 'vidax.json');
  const configPath = process.env.VIDAX_CONFIG || (fs.existsSync(candidateStateConfig) ? candidateStateConfig : path.join(process.cwd(), 'config', 'vidax.json'));
  if (fs.existsSync(configPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    fileConfig.assets_config = process.env.VIDAX_ASSETS_CONFIG || fileConfig.assets_config || resolveAssetsConfigPath();
    fileConfig.state_dir = expandPath(fileConfig.state_dir || stateRoot);
    return fileConfig;
  }
  return {
    apiKey: process.env.VIDAX_API_KEY,
    port: process.env.VIDAX_PORT || 3000,
    bind: process.env.VIDAX_BIND || '127.0.0.1',
    state_dir: expandPath(stateRoot),
    assets_config: process.env.VIDAX_ASSETS_CONFIG || resolveAssetsConfigPath(),
    comfyui: {},
  };
}

function requireApiKey(config) {
  const apiKey = process.env.VIDAX_API_KEY || config.apiKey;
  if (!apiKey) {
    throw new AppError('AUTH_CONFIGURATION', 'VIDAX API key is required');
  }
  return apiKey;
}

function startServer() {
  const config = loadConfig();
  const apiKey = requireApiKey(config);
  config.apiKey = apiKey;
  if (!config.comfyui) {
    config.comfyui = {};
  }
  config.assets_config = expandPath(config.assets_config || resolveAssetsConfigPath());
  config.state_dir = expandPath(config.state_dir || stateRoot);
  if (!config.comfyui.state_dir) {
    config.comfyui.state_dir = config.state_dir || stateRoot;
  }
  if (!config.comfyui.assets_config) {
    config.comfyui.assets_config = config.assets_config || resolveAssetsConfigPath();
  }
  if (config.comfyui.paths) {
    if (config.comfyui.paths.workflows_dir) {
      config.comfyui.paths.workflows_dir = expandPath(config.comfyui.paths.workflows_dir);
    }
    if (config.comfyui.paths.models_dir) {
      config.comfyui.paths.models_dir = expandPath(config.comfyui.paths.models_dir);
    }
  }
  const comfyuiClient = new ComfyUIClient(config.comfyui || {});
  const processManager = new ProcessManager(config.comfyui || {}, comfyuiClient);
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware(config, apiKey));
  app.use('/', createRouter(config, { processManager, comfyuiClient }));
  const port = config.port || 3000;
  const host = config.bind || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`VIDAX server listening on ${host}:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
