class ComfyUIClient {
  constructor(config = {}) {
    this.baseUrl = config.url;
    this.healthEndpoint = config.health_endpoint || '/health';
    this.promptEndpoint = config.prompt_endpoint || '/prompt';
    this.timeout = config.timeout_total || 60000;
  }

  async health() {
    if (!this.baseUrl) {
      return { ok: false, error: 'baseUrl_missing' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${this.healthEndpoint}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText };
      }
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }
      return { ok: true, url: this.baseUrl, data };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: err.message };
    }
  }

  async submitPrompt(payload) {
    if (!this.baseUrl) {
      const error = new Error('ComfyUI baseUrl missing');
      error.code = 'COMFYUI_URL_MISSING';
      throw error;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${this.promptEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text();
        const error = new Error(`ComfyUI prompt failed (${res.status})`);
        error.details = text;
        throw error;
      }
      try {
        return await res.json();
      } catch (err) {
        return { status: 'submitted' };
      }
    } catch (err) {
      clearTimeout(timer);
      err.code = err.code || 'COMFYUI_REQUEST_FAILED';
      throw err;
    }
  }
}

module.exports = ComfyUIClient;
