const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
let FormDataConstructor = globalThis.FormData;
if (!FormDataConstructor) {
  try {
    ({ FormData: FormDataConstructor } = require('undici'));
  } catch (err) {
    FormDataConstructor = null;
  }
}

const streamPipeline = promisify(pipeline);
const imageExt = ['.png', '.jpg', '.jpeg', '.webp'];

class ComfyUIClient {
  constructor(config = {}) {
    this.baseUrl = config.url || 'http://127.0.0.1:8188';
    this.healthEndpoint = config.health_endpoint || '/system_stats';
    this.promptEndpoint = config.prompt_endpoint || '/prompt';
    this.historyEndpoint = config.history_endpoint || '/history';
    this.viewEndpoint = config.view_endpoint || '/view';
    this.timeout = config.timeout_total || 60000;
    this.inputDir = this.resolveInputDir(config);
  }

  resolveInputDir(config = {}) {
    if (config.input_dir) {
      return path.resolve(config.input_dir);
    }
    if (process.env.COMFYUI_INPUT_DIR) {
      return path.resolve(process.env.COMFYUI_INPUT_DIR);
    }
    if (process.env.COMFYUI_DIR) {
      return path.resolve(path.join(process.env.COMFYUI_DIR, 'input'));
    }
    if (process.platform === 'win32') {
      return 'F:\\ComfyUI\\input';
    }
    return null;
  }

  async health() {
    if (!this.baseUrl) {
      return { ok: false, error: 'baseUrl_missing' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const attemptHealth = async (endpoint) => {
      const res = await fetch(`${this.baseUrl}${endpoint}`, { signal: controller.signal });
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText };
      }
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }
      return { ok: true, url: this.baseUrl, status: res.status, data };
    };
    try {
      const first = await attemptHealth(this.healthEndpoint);
      if (first.ok || this.healthEndpoint === '/health') {
        clearTimeout(timer);
        return first;
      }
      const fallback = await attemptHealth('/health');
      clearTimeout(timer);
      return fallback;
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: err.message };
    }
  }

  async getObjectInfo() {
    if (!this.baseUrl) {
      return { ok: false, error: 'baseUrl_missing' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}/object_info`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: err.message };
    }
  }

  async uploadFile(localPath, remoteName) {
    if (!this.baseUrl) {
      const error = new Error('ComfyUI baseUrl missing');
      error.code = 'COMFYUI_URL_MISSING';
      throw error;
    }
    if (!localPath) {
      const error = new Error('upload path missing');
      error.code = 'COMFYUI_UPLOAD_FAILED';
      throw error;
    }
    const filename = remoteName || path.basename(localPath);
    const ext = path.extname(filename).toLowerCase();
    const copyToInput = (method = 'copy') => {
      if (!this.inputDir) {
        const error = new Error('ComfyUI input_dir missing for upload copy');
        error.code = 'COMFYUI_UPLOAD_FAILED';
        error.details = { input_dir: this.inputDir, source: localPath };
        throw error;
      }
      if (!fs.existsSync(this.inputDir)) {
        const error = new Error('ComfyUI input_dir not found for upload copy');
        error.code = 'COMFYUI_UPLOAD_FAILED';
        error.details = { input_dir: this.inputDir, source: localPath };
        throw error;
      }
      fs.mkdirSync(this.inputDir, { recursive: true });
      const dest = path.join(this.inputDir, filename);
      fs.copyFileSync(localPath, dest);
      return { ok: true, filename, method };
    };
    if (imageExt.includes(ext)) {
      if (!FormDataConstructor) {
        const error = new Error('FormData not available for upload');
        error.code = 'COMFYUI_UPLOAD_FAILED';
        throw error;
      }
      const form = new FormDataConstructor();
      form.append('image', fs.createReadStream(localPath), filename);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(`${this.baseUrl}/upload/image`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text();
          const error = new Error(`ComfyUI upload failed (${res.status})`);
          error.details = text;
          error.code = 'COMFYUI_UPLOAD_FAILED';
          throw error;
        }
        return { ok: true, filename, method: 'http' };
      } catch (err) {
        clearTimeout(timer);
        if (this.inputDir) {
          return copyToInput('copy_fallback');
        }
        err.code = err.code || 'COMFYUI_UPLOAD_FAILED';
        throw err;
      }
    }
    return copyToInput('copy');
  }

  stageInputFile(localPath, desiredName, options = {}) {
    const force = options.force === true;
    const inputDir = this.inputDir || this.resolveInputDir(options);
    if (!inputDir) {
      const error = new Error('ComfyUI input_dir missing for staging');
      error.code = 'COMFYUI_UPLOAD_FAILED';
      error.details = { input_dir: inputDir, source: localPath };
      throw error;
    }
    if (!localPath || !desiredName) {
      const error = new Error('stageInputFile requires localPath and desiredName');
      error.code = 'COMFYUI_UPLOAD_FAILED';
      error.details = { input_dir: inputDir, source: localPath, desired: desiredName };
      throw error;
    }
    if (!fs.existsSync(localPath)) {
      const error = new Error('stageInputFile source missing');
      error.code = 'COMFYUI_UPLOAD_FAILED';
      error.details = { source: localPath };
      throw error;
    }
    fs.mkdirSync(inputDir, { recursive: true });
    const dest = path.join(inputDir, desiredName);
    if (path.resolve(localPath) === path.resolve(dest)) {
      return { name: desiredName, fullPath: dest, method: 'reuse' };
    }
    const srcStat = fs.statSync(localPath);
    if (fs.existsSync(dest)) {
      const destStat = fs.statSync(dest);
      if (!force && destStat.size === srcStat.size) {
        return { name: desiredName, fullPath: dest, method: 'reuse' };
      }
    }
    fs.copyFileSync(localPath, dest);
    return { name: desiredName, fullPath: dest, method: 'copy' };
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
    const defaultVideoTarget = videoTarget || (comfyuiDir ? path.join(comfyuiDir, 'comfyui_video.mp4') : null);
    if (defaultVideoTarget && videos.length > 0) {
      const preferredVideo =
        videos.find((v) => (v.filename || '').toLowerCase().endsWith('.mp4')) ||
        videos.find((v) => (v.url || '').toLowerCase().includes('.mp4')) ||
        videos[0];
      fs.mkdirSync(path.dirname(defaultVideoTarget), { recursive: true });
      await this.downloadTo(preferredVideo.url, defaultVideoTarget);
      return { output_kind: 'video', output_paths: [defaultVideoTarget] };
    }

    const frames = outputs.filter((o) => o.kind === 'frame' && o.url);
    if (frames.length > 0 && framesDir) {
      const sortedFrames = frames
        .map((frame, idx) => ({
          frame,
          idx,
          filename: frame.filename || '',
          url: frame.url || '',
        }))
        .sort((a, b) => {
          if (a.filename && b.filename) {
            const cmp = a.filename.localeCompare(b.filename);
            if (cmp !== 0) return cmp;
          } else if (a.filename && !b.filename) {
            return -1;
          } else if (!a.filename && b.filename) {
            return 1;
          }
          if (a.url && b.url) {
            const cmpUrl = a.url.localeCompare(b.url);
            if (cmpUrl !== 0) return cmpUrl;
          }
          return a.idx - b.idx;
        });
      let index = 0;
      const paths = [];
      for (const item of sortedFrames) {
        const frame = item.frame;
        const name = `${String(index + 1).padStart(6, '0')}.png`;
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
