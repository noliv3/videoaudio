const { spawn } = require('child_process');

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
    this.config = { ...defaults, ...config };
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
      const error = new Error('ComfyUI command not configured');
      error.code = 'COMFYUI_COMMAND_MISSING';
      this.state = 'error';
      this.startPromise = null;
      throw error;
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
    const error = new Error('ComfyUI startup timeout');
    error.code = 'COMFYUI_TIMEOUT';
    this.startPromise = null;
    throw error;
  }

  spawnProcess() {
    if (this.process) return;
    const env = { ...process.env, ...(this.config.env || {}) };
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

  shutdown() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.state = 'idle';
  }
}

module.exports = ProcessManager;
