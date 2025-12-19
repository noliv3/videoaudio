const path = require('path');
const { spawn } = require('child_process');
const { ensureAllAssets } = require('../setup/assets');
const { stateDir } = require('../runner/paths');
const { AppError } = require('../errors');

const defaults = {
  health_endpoint: '/health',
  startup_timeout_ms: 60000,
  poll_interval_ms: 500,
  auto_start: true,
  args: [],
  env: {},
  cwd: process.cwd(),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProcessManager {
  constructor(config = {}, comfyuiClient) {
    this.config = Object.assign({}, defaults, config);
    this.comfyuiClient = comfyuiClient;
    this.state = 'idle';
    this.process = null;
    this.startPromise = null;
    this.signalsAttached = false;
    this.attachSignalHandlers();
  }

  attachSignalHandlers() {
    if (this.signalsAttached) return;
    ['SIGINT', 'SIGTERM'].forEach((sig) => {
      process.on(sig, () => {
        this.shutdown();
      });
    });
    this.signalsAttached = true;
  }

  async ensureComfyUI() {
    await this.ensureAssetsReady();
    const healthy = await this.checkHealth();
    if (healthy.ok) {
      this.state = 'ready';
      return { status: 'ready', url: this.config.url };
    }

    if (!this.config.auto_start) {
      const error = new Error('ComfyUI not reachable and auto_start disabled');
      error.code = 'COMFYUI_UNAVAILABLE';
      throw error;
    }

    if (!this.startPromise) {
      this.startPromise = this.startComfyUI();
    }
    return this.startPromise;
  }

  async startComfyUI() {
    this.state = 'starting';
    if (!this.config.command) {
      const err = new AppError('COMFYUI_COMMAND_MISSING', 'ComfyUI command not configured');
      this.state = 'error';
      this.startPromise = null;
      throw err;
    }
    this.spawnProcess();

    const deadline = Date.now() + this.config.startup_timeout_ms;
    while (Date.now() < deadline) {
      const healthy = await this.checkHealth();
      if (healthy.ok) {
        this.state = 'ready';
        this.startPromise = null;
        return { status: 'ready', url: this.config.url };
      }
      await delay(this.config.poll_interval_ms);
    }

    this.state = 'error';
    this.shutdown();
    const err = new AppError('COMFYUI_TIMEOUT', 'ComfyUI startup timeout');
    this.startPromise = null;
    throw err;
  }

  spawnProcess() {
    if (this.process) return;
    const env = Object.assign({}, process.env, this.config.env || {});
    if (this.config.paths && this.config.paths.workflows_dir) {
      env.COMFYUI_WORKFLOWS_DIR = this.config.paths.workflows_dir;
    }
    if (this.config.paths && this.config.paths.models_dir) {
      env.COMFYUI_MODELS_DIR = this.config.paths.models_dir;
    }
    const args = Array.isArray(this.config.args) ? this.config.args : [];
    const child = spawn(this.config.command, args, {
      cwd: this.config.cwd || process.cwd(),
      env,
      stdio: 'inherit',
    });
    this.process = child;
    child.on('exit', () => {
      this.process = null;
      if (this.state !== 'error') {
        this.state = 'idle';
      }
    });
    child.on('error', () => {
      this.process = null;
      this.state = 'error';
    });
  }

  async checkHealth() {
    if (!this.comfyuiClient) {
      return { ok: false, reason: 'client_missing' };
    }
    try {
      return await this.comfyuiClient.health();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async ensureAssetsReady() {
    if (!this.config.assets_config) return true;
    const assetsStateDir = this.config.state_dir || stateDir;
    const status = await ensureAllAssets(this.config.assets_config, assetsStateDir, { install: false, strict: false });
    if (!status.ok) {
      const missing = [...(status.workflows || []), ...(status.models || [])].filter((item) => item.status !== 'ok');
      const code = missing.some((m) => m.status === 'missing') ? 'INPUT_NOT_FOUND' : 'VALIDATION_ERROR';
      throw new AppError(code, 'required ComfyUI assets missing or invalid', { assets: status });
    }
    if (!this.config.paths) {
      this.config.paths = {};
    }
    if (!this.config.paths.workflows_dir) {
      this.config.paths.workflows_dir = path.join(assetsStateDir, 'comfyui', 'workflows');
    }
    if (!this.config.paths.models_dir) {
      this.config.paths.models_dir = path.join(assetsStateDir, 'comfyui', 'models');
    }
    return true;
  }

  shutdown() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.state = 'idle';
  }
}

module.exports = ProcessManager;
