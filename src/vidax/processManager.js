class ProcessManager {
  constructor(config = {}) {
    this.config = config;
    this.state = 'idle';
  }

  async ensureComfyUI() {
    this.state = 'ready';
    return { status: 'ready', url: this.config.url };
  }
}

module.exports = ProcessManager;
