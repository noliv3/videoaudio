const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

class ComfyUIClient {
  constructor(config = {}) {
    this.baseUrl = config.url;
    this.healthEndpoint = config.health_endpoint || '/health';
    this.promptEndpoint = config.prompt_endpoint || '/prompt';
    this.historyEndpoint = config.history_endpoint || '/history';
    this.viewEndpoint = config.view_endpoint || '/view';
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
        error.code = 'COMFYUI_BAD_RESPONSE';
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

  async waitForCompletion(promptId, options = {}) {
    if (!this.baseUrl) {
      const error = new Error('ComfyUI baseUrl missing');
      error.code = 'COMFYUI_URL_MISSING';
      throw error;
    }
    if (!promptId) {
      const error = new Error('ComfyUI prompt_id missing');
      error.code = 'COMFYUI_BAD_RESPONSE';
      throw error;
    }
    const timeoutTotal = options.timeout_total || this.timeout || 60000;
    const pollInterval = options.poll_interval_ms || 500;
    const deadline = Date.now() + timeoutTotal;
    let lastData = null;
    while (Date.now() < deadline) {
      const result = await this.fetchHistory(promptId);
      if (result && result.done) {
        return { status: 'completed', outputs: result.outputs || [], raw: result.raw };
      }
      lastData = result;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    const error = new Error('ComfyUI polling timeout');
    error.code = 'COMFYUI_TIMEOUT';
    error.details = { prompt_id: promptId, last: lastData };
    throw error;
  }

  async fetchHistory(promptId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const endpoints = [
      `${this.baseUrl}${this.historyEndpoint}/${promptId}`,
      `${this.baseUrl}${this.historyEndpoint}?prompt_id=${encodeURIComponent(promptId)}`,
      `${this.baseUrl}${this.historyEndpoint}`,
    ];
    try {
      for (const url of endpoints) {
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) continue;
          const data = await res.json();
          const entry = this.extractHistoryEntry(data, promptId);
          if (entry) {
            clearTimeout(timer);
            return entry;
          }
        } catch (err) {
          continue;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  extractHistoryEntry(data, promptId) {
    if (!data) return null;
    const candidate = data.history?.[promptId] || data[promptId] || data.history || data;
    const outputs = this.normalizeOutputs(candidate?.outputs || candidate?.output || []);
    const done = Boolean(candidate?.status?.completed || candidate?.status?.done || outputs.length > 0);
    return { done, outputs, raw: candidate };
  }

  normalizeOutputs(outputs) {
    if (!outputs) return [];
    if (Array.isArray(outputs)) {
      return outputs.flatMap((item) => this.normalizeOutputs(item.outputs || item.output || item));
    }
    const collected = [];
    if (outputs.images && Array.isArray(outputs.images)) {
      outputs.images.forEach((img) => {
        collected.push({
          kind: 'frame',
          url: this.buildViewUrl(img),
          filename: img.filename || null,
        });
      });
    }
    if (outputs.videos && Array.isArray(outputs.videos)) {
      outputs.videos.forEach((vid) => {
        collected.push({
          kind: 'video',
          url: this.buildViewUrl(vid),
          filename: vid.filename || null,
        });
      });
    }
    if (outputs.kind && outputs.url) {
      collected.push(outputs);
    }
    return collected;
  }

  buildViewUrl(entry) {
    if (!entry) return null;
    if (entry.url) return entry.url.startsWith('http') ? entry.url : `${this.baseUrl}${entry.url}`;
    const params = new URLSearchParams();
    if (entry.filename) params.append('filename', entry.filename);
    if (entry.subfolder) params.append('subfolder', entry.subfolder);
    if (entry.type) params.append('type', entry.type);
    return `${this.baseUrl}${this.viewEndpoint}?${params.toString()}`;
  }

  async collectOutputs(promptId, destPaths = {}, options = {}) {
    const outputs = options.outputs || [];
    if (!outputs.length) {
      const error = new Error('ComfyUI outputs missing');
      error.code = 'COMFYUI_BAD_RESPONSE';
      throw error;
    }
    const videoTarget = destPaths.videoPath;
    const framesDir = destPaths.framesDir;
    const comfyuiDir = destPaths.comfyuiDir;
    if (comfyuiDir) {
      fs.mkdirSync(comfyuiDir, { recursive: true });
    }
    if (framesDir) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    const videos = outputs.filter((o) => o.kind === 'video' && o.url);
    if (videoTarget && videos.length > 0) {
      await this.downloadTo(videos[0].url, videoTarget);
      return { output_kind: 'video', output_paths: [videoTarget] };
    }

    const frames = outputs.filter((o) => o.kind === 'frame' && o.url);
    if (frames.length > 0 && framesDir) {
      let index = 1;
      const paths = [];
      for (const frame of frames) {
        const name = frame.filename || `${String(index).padStart(6, '0')}.png`;
        const dest = path.join(framesDir, name);
        await this.downloadTo(frame.url, dest);
        paths.push(dest);
        index += 1;
      }
      return { output_kind: 'frames', output_paths: paths };
    }

    const error = new Error('ComfyUI outputs not usable');
    error.code = 'COMFYUI_BAD_RESPONSE';
    throw error;
  }

  async downloadTo(url, dest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        const error = new Error(`download failed (${res.status})`);
        error.code = 'COMFYUI_BAD_RESPONSE';
        throw error;
      }
      await streamPipeline(res.body, fs.createWriteStream(dest));
    } catch (err) {
      err.code = err.code || 'COMFYUI_BAD_RESPONSE';
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = ComfyUIClient;
