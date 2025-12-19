const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { spawn } = require('child_process');
const { AppError } = require('../errors');
const { stateRoot } = require('../runner/paths');

const streamPipeline = promisify(pipeline);
const defaultPolicy = {
  on_missing: 'download',
  on_hash_mismatch: 'fail',
  allow_insecure_http: false,
};

function expandPath(p) {
  if (!p) return null;
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(p);
}

function resolveAssetsConfigPath() {
  if (process.env.VIDAX_ASSETS_CONFIG) {
    return expandPath(process.env.VIDAX_ASSETS_CONFIG);
  }
  const stateConfig = path.join(stateRoot, 'config', 'assets.json');
  if (fs.existsSync(stateConfig)) {
    return stateConfig;
  }
  return path.join(process.cwd(), 'config', 'assets.json');
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new AppError('INPUT_NOT_FOUND', 'assets manifest missing', { manifest: manifestPath });
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(raw);
    return data;
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', 'invalid assets manifest', { manifest: manifestPath, error: err.message });
  }
}

async function downloadTo(url, dest, options = {}) {
  const { allowInsecure = false } = options;
  if (!allowInsecure && url.startsWith('http://')) {
    throw new AppError('UNSUPPORTED_FORMAT', 'insecure download blocked', { url });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const client = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new AppError('INPUT_NOT_FOUND', 'asset download failed', { url, status: response.statusCode }));
        return;
      }
      streamPipeline(response, fs.createWriteStream(dest))
        .then(() => resolve(dest))
        .catch((err) => reject(new AppError('OUTPUT_WRITE_FAILED', 'asset write failed', { url, dest, error: err.message })));
    });
    request.on('error', (err) => reject(new AppError('INPUT_NOT_FOUND', 'asset download failed', { url, error: err.message })));
  });
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => reject(err));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function resolvePaths(asset, stateDir) {
  if (!asset || !asset.dest) {
    throw new AppError('VALIDATION_ERROR', 'asset.dest missing', { asset });
  }
  const destPath = path.isAbsolute(asset.dest) ? asset.dest : path.join(stateDir, asset.dest);
  const baseDir = asset.unpack ? destPath : path.dirname(destPath);
  const metaPath = asset.unpack ? path.join(destPath, '.asset-meta.json') : `${destPath}.asset-meta.json`;
  return { destPath, baseDir, metaPath };
}

async function unpackZip(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: 'ignore' });
    child.on('error', (err) => reject(new AppError('OUTPUT_WRITE_FAILED', 'unzip failed', { archive: archivePath, error: err.message })));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new AppError('OUTPUT_WRITE_FAILED', 'unzip failed', { archive: archivePath, code }));
      }
    });
  });
}

function recordMeta(metaPath, data) {
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8');
}

function readMeta(metaPath) {
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

async function verifyExisting(asset, paths) {
  if (asset.unpack) {
    if (!fs.existsSync(paths.destPath) || !fs.statSync(paths.destPath).isDirectory()) {
      return { status: 'missing' };
    }
    const meta = readMeta(paths.metaPath);
    if (meta && meta.sha256 && asset.sha256 && meta.sha256 === asset.sha256) {
      return { status: 'ok', verified: true };
    }
    const files = fs.readdirSync(paths.destPath);
    return files.length > 0 ? { status: 'unknown', files: files.length } : { status: 'missing' };
  }

  if (!fs.existsSync(paths.destPath)) {
    return { status: 'missing' };
  }
  if (!asset.sha256) {
    return { status: 'ok', verified: false };
  }
  const hash = await sha256File(paths.destPath);
  if (hash === asset.sha256) {
    return { status: 'ok', verified: true, hash };
  }
  return { status: 'hash_mismatch', hash };
}

async function installAsset(asset, policy, stateDir) {
  const paths = resolvePaths(asset, stateDir);
  fs.mkdirSync(paths.baseDir, { recursive: true });
  const existing = await verifyExisting(asset, paths);
  if (existing.status === 'ok') {
    return { id: asset.id, path: paths.destPath, status: 'ok', action: 'present', hash: existing.hash || null };
  }
  if (existing.status === 'hash_mismatch' && policy.on_hash_mismatch === 'fail') {
    throw new AppError('UNSUPPORTED_FORMAT', 'asset hash mismatch', { asset: asset.id, path: paths.destPath, expected: asset.sha256, actual: existing.hash });
  }
  if (existing.status === 'missing' && policy.on_missing !== 'download') {
    throw new AppError('INPUT_NOT_FOUND', 'asset missing', { asset: asset.id, path: paths.destPath });
  }

  const downloadTarget = asset.unpack ? path.join(paths.baseDir, `${asset.id || path.basename(paths.destPath)}.zip`) : paths.destPath;
  await downloadTo(asset.url, downloadTarget, { allowInsecure: policy.allow_insecure_http });
  const downloadedHash = await sha256File(downloadTarget);
  if (asset.sha256 && downloadedHash !== asset.sha256) {
    throw new AppError('UNSUPPORTED_FORMAT', 'asset hash mismatch after download', { asset: asset.id, expected: asset.sha256, actual: downloadedHash });
  }
  if (asset.unpack) {
    await unpackZip(downloadTarget, paths.destPath);
    recordMeta(paths.metaPath, { id: asset.id, url: asset.url, sha256: asset.sha256 || null });
    return { id: asset.id, path: paths.destPath, status: 'installed', action: 'downloaded_unpacked' };
  }
  return { id: asset.id, path: paths.destPath, status: 'installed', action: existing.status === 'hash_mismatch' ? 'replaced' : 'downloaded', hash: downloadedHash };
}

async function summarizeAsset(asset, policy, stateDir) {
  const paths = resolvePaths(asset, stateDir);
  const status = await verifyExisting(asset, paths);
  const base = { id: asset.id, path: paths.destPath, status: status.status };
  if (status.hash) base.hash = status.hash;
  if (asset.sha256) base.expected = asset.sha256;
  if (status.files) base.files = status.files;
  return base;
}

async function ensureAllAssets(manifestPath, stateDir, options = {}) {
  const { install = true, strict = true } = options;
  const manifest = readManifest(manifestPath);
  const policy = Object.assign({}, defaultPolicy, manifest.policy || {});
  const summary = {
    manifest: manifestPath,
    state_dir: stateDir,
    policy,
    workflows: [],
    models: [],
  };
  let ok = true;
  const categories = ['workflows', 'models'];
  for (const category of categories) {
    const entries = Array.isArray(manifest[category]) ? manifest[category] : [];
    for (const asset of entries) {
      try {
        const result = install
          ? await installAsset(asset, policy, stateDir)
          : await summarizeAsset(asset, policy, stateDir);
        summary[category].push(result);
        if (result.status !== 'ok' && result.status !== 'installed') {
          ok = false;
        }
      } catch (err) {
        ok = false;
        if (strict) throw err;
        summary[category].push({ id: asset.id, path: asset.dest, status: 'error', error: err.message, code: err.code });
      }
    }
  }
  summary.ok = ok;
  return summary;
}

module.exports = {
  downloadTo,
  sha256File,
  ensureAllAssets,
  resolveAssetsConfigPath,
};
