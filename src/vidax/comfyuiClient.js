class ComfyUIClient {
  constructor(config = {}) {
    this.baseUrl = config.url;
    this.healthEndpoint = config.health_endpoint || '/health';
  }

  async health() {
    return { ok: true, url: this.baseUrl };
  }

  async submitPrompt(payload) {
    return { status: 'stub', payload };
  }
}

module.exports = ComfyUIClient;
