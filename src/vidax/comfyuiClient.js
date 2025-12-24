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
const { AppError } = require('../errors');

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
    try {
      const endpoint = this.healthEndpoint || '/system_stats';
      const res = await fetch(`${this.baseUrl}${endpoint}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText, endpoint };
      }
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }
      if (!data) {
        return { ok: false, status: res.status, statusText: res.statusText, endpoint, error: 'empty_body' };
      }
      return { ok: true, url: this.baseUrl, status: res.status, data, endpoint };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: err.message, endpoint: this.healthEndpoint || '/system_stats' };
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
    const stallThreshold = options.history_poll_threshold_ms || Math.max(5000, pollInterval * 4);
    const emptyThreshold = options.empty_output_history_ms || stallThreshold;
    const deadline = Date.now() + timeoutTotal;
    let lastData = null;
    let lastProgress = Date.now();
    let lastOutputCount = 0;
    while (Date.now() < deadline) {
      const result = await this.fetchHistory(promptId);
      const outputCount = result?.outputs?.length || 0;
      if (result?.historyError) {
        throw new AppError('COMFYUI_PROMPT_FAILED', result.historyError, {
          prompt_id: promptId,
          history_error: result.historyError,
        });
      }
      if (result?.done) {
        if (outputCount === 0) {
          const historyCheck = await this.fetchHistory(promptId, { directOnly: true });
          if (historyCheck?.historyError) {
            throw new AppError('COMFYUI_PROMPT_FAILED', historyCheck.historyError, {
              prompt_id: promptId,
              history_error: historyCheck.historyError,
            });
          }
        }
        return { status: 'completed', outputs: result.outputs || [], raw: result.raw };
      }
      if (outputCount > lastOutputCount) {
        lastProgress = Date.now();
        lastOutputCount = outputCount;
      }
      const stalledTooLong = Date.now() - lastProgress >= stallThreshold;
      const emptyTooLong = outputCount === 0 && Date.now() - lastProgress >= emptyThreshold;
      if (stalledTooLong || emptyTooLong) {
        const historyCheck = await this.fetchHistory(promptId, { directOnly: true });
        if (historyCheck?.historyError) {
          throw new AppError('COMFYUI_PROMPT_FAILED', historyCheck.historyError, {
            prompt_id: promptId,
            history_error: historyCheck.historyError,
          });
        }
        lastData = historyCheck || result;
        lastProgress = Date.now();
      } else {
        lastData = result;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    const error = new Error('ComfyUI polling timeout');
    error.code = 'COMFYUI_TIMEOUT';
    error.details = { prompt_id: promptId, last: lastData };
    throw error;
  }

  async fetchHistory(promptId, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const endpoints = [
      `${this.baseUrl}${this.historyEndpoint}/${promptId}`,
      `${this.baseUrl}${this.historyEndpoint}?prompt_id=${encodeURIComponent(promptId)}`,
      `${this.baseUrl}${this.historyEndpoint}`,
    ];
    try {
      const targetEndpoints = options.directOnly ? endpoints.slice(0, 1) : endpoints;
      for (const url of targetEndpoints) {
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
    const historyError = this.extractHistoryError(candidate);
    const done = Boolean(candidate?.status?.completed || candidate?.status?.done || outputs.length > 0);
    return { done, outputs, raw: candidate, historyError };
  }

  extractHistoryError(candidate) {
    if (!candidate) return null;
    const status = candidate.status || {};
    if (status.error) return status.error;
    const statusValue = typeof status.status === 'string' ? status.status.toLowerCase() : null;
    if (statusValue === 'error') {
      return status.error || status.message || status.status;
    }
    if (status.exception) {
      if (typeof status.exception === 'string') return status.exception;
      if (typeof status.exception?.message === 'string') return status.exception.message;
    }
    if (Array.isArray(status.messages)) {
      const msg = status.messages.find((m) => {
        const tag = (m?.type || m?.level || m?.severity || '').toString().toLowerCase();
        return tag === 'error';
      });
      if (msg?.message) return msg.message;
      if (msg?.text) return msg.text;
    }
    if (candidate.error) return candidate.error;
    if (candidate.exception) {
      if (typeof candidate.exception === 'string') return candidate.exception;
      if (candidate.exception?.message) return candidate.exception.message;
    }
    return null;
  }

  extractHistoryMessages(candidate) {
    if (!candidate) return [];
    const status = candidate.status || {};
    const messages = Array.isArray(status.messages) ? status.messages : candidate.messages;
    const collected = [];
    if (status.message) collected.push(status.message);
    if (Array.isArray(messages)) {
      messages.forEach((msg) => {
        if (msg?.message) collected.push(msg.message);
        else if (msg?.text) collected.push(msg.text);
      });
    }
    return collected.filter(Boolean).map((msg) => msg.toString());
  }

  extractNodeErrors(candidate) {
    const nodeErrors = candidate?.node_errors || candidate?.status?.node_errors;
    if (!nodeErrors || typeof nodeErrors !== 'object') return [];
    return Object.entries(nodeErrors)
      .map(([node, err]) => ({
        node,
        error: typeof err === 'string' ? err : err?.message || err,
      }))
      .filter((entry) => entry.error);
  }

  hasHistoryError(candidate) {
    if (!candidate) return false;
    const status = candidate.status || {};
    const statusValue = typeof status.status === 'string' ? status.status.toLowerCase() : null;
    if (statusValue === 'error' || statusValue === 'failed') return true;
    if (Array.isArray(status.messages)) {
      return status.messages.some((msg) => {
        const tag = (msg?.type || msg?.level || msg?.severity || '').toString().toLowerCase();
        return tag === 'error' || tag === 'failed';
      });
    }
    return false;
  }

  summarizeHistory(historyEntry) {
    if (!historyEntry) return { found: false };
    const raw = historyEntry.raw || {};
    const status = raw.status || {};
    const messages = this.extractHistoryMessages(raw);
    const nodeErrors = this.extractNodeErrors(raw);
    return {
      found: true,
      done: !!historyEntry.done,
      output_count: historyEntry.outputs?.length || 0,
      status: status.status || status.state || status.value || null,
      error: historyEntry.historyError || null,
      messages: messages.slice(0, 5),
      node_errors: nodeErrors.slice(0, 5),
    };
  }

  normalizeOutputs(outputs) {
    if (!outputs) return [];
    if (Array.isArray(outputs)) {
      return outputs.flatMap((item) => this.normalizeOutputs(item.outputs || item.output || item));
    }
    if (outputs && typeof outputs === 'object') {
      const hasMedia =
        (outputs.images && Array.isArray(outputs.images)) || (outputs.videos && Array.isArray(outputs.videos));
      const hasKindUrl = outputs.kind && outputs.url;
      const keyList = Object.keys(outputs);
      const mapLike = keyList.length > 0 && keyList.every((k) => /^[0-9]+$/.test(k) || typeof outputs[k] === 'object');
      if (!hasMedia && !hasKindUrl) {
        return Object.values(outputs).flatMap((item) =>
          this.normalizeOutputs(item?.outputs || item?.output || item || [])
        );
      }
      if (mapLike) {
        return keyList.flatMap((key) => this.normalizeOutputs(outputs[key]));
      }
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
      const historyEntry = promptId ? await this.fetchHistory(promptId, { directOnly: true }) : null;
      const historyMessages = this.extractHistoryMessages(historyEntry?.raw);
      const nodeErrors = this.extractNodeErrors(historyEntry?.raw);
      const hasError = historyEntry?.historyError || this.hasHistoryError(historyEntry?.raw);
      const summary = this.summarizeHistory(historyEntry);
      if (hasError) {
        throw new AppError('COMFYUI_PROMPT_FAILED', historyEntry?.historyError || 'ComfyUI prompt failed', {
          prompt_id: promptId,
          history_error: historyEntry?.historyError || null,
          node_errors: nodeErrors.length ? nodeErrors : undefined,
          messages: historyMessages.length ? historyMessages : undefined,
        });
      }
      throw new AppError('COMFYUI_OUTPUTS_MISSING', 'ComfyUI outputs missing', {
        prompt_id: promptId,
        history: summary,
        node_errors: nodeErrors.length ? nodeErrors : undefined,
        messages: historyMessages.length ? historyMessages : undefined,
      });
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
module.exports.normalizeOutputs = (outputs, config = {}) => new ComfyUIClient(config).normalizeOutputs(outputs);
module.exports.extractHistoryEntry = (data, promptId, config = {}) =>
  new ComfyUIClient(config).extractHistoryEntry(data, promptId);
