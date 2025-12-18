const fs = require('fs');
const path = require('path');
const express = require('express');
const createRouter = require('./routes');
const createAuthMiddleware = require('./auth');
const ProcessManager = require('./processManager');
const ComfyUIClient = require('./comfyuiClient');
const { AppError } = require('../errors');

function loadConfig() {
  const configPath = process.env.VIDAX_CONFIG || path.join(process.cwd(), 'config', 'vidax.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {
    apiKey: process.env.VIDAX_API_KEY,
    port: process.env.VIDAX_PORT || 3000,
    bind: process.env.VIDAX_BIND || '127.0.0.1',
    comfyui: {},
  };
}

function requireApiKey(config) {
  const apiKey = process.env.VIDAX_API_KEY || config.apiKey;
  if (!apiKey) {
    throw new AppError('VALIDATION_ERROR', 'VIDAX API key is required');
  }
  return apiKey;
}

function startServer() {
  const config = loadConfig();
  requireApiKey(config);
  const comfyuiClient = new ComfyUIClient(config.comfyui || {});
  const processManager = new ProcessManager(config.comfyui || {}, comfyuiClient);
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware(config));
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
