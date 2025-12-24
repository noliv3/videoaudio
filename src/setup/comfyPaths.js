const fs = require('fs');
const path = require('path');
const { stateRoot } = require('../runner/paths');

function resolveComfyRoot() {
  if (process.env.COMFYUI_DIR) {
    const resolved = path.isAbsolute(process.env.COMFYUI_DIR)
      ? process.env.COMFYUI_DIR
      : path.resolve(process.env.COMFYUI_DIR);
    if (path.basename(resolved).toLowerCase() === 'custom_nodes') {
      return path.dirname(resolved);
    }
    return resolved;
  }
  return path.join(stateRoot, 'comfyui');
}

function resolveCustomNodesDir() {
  if (process.env.COMFYUI_DIR) {
    const resolved = path.isAbsolute(process.env.COMFYUI_DIR)
      ? process.env.COMFYUI_DIR
      : path.resolve(process.env.COMFYUI_DIR);
    if (path.basename(resolved).toLowerCase() === 'custom_nodes') {
      return resolved;
    }
    return path.join(resolved, 'custom_nodes');
  }
  if (process.platform === 'win32') {
    return 'F:\\\\ComfyUI\\\\custom_nodes';
  }
  return path.join(stateRoot, 'comfyui', 'custom_nodes');
}

function resolveComfyPython() {
  if (process.env.COMFYUI_PYTHON) {
    return process.env.COMFYUI_PYTHON;
  }
  const comfyRoot = resolveComfyRoot();
  const isWin = process.platform === 'win32';
  const venvScript = path.join(comfyRoot, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
  if (fs.existsSync(venvScript)) {
    return venvScript;
  }
  return 'python';
}

module.exports = {
  resolveComfyRoot,
  resolveCustomNodesDir,
  resolveComfyPython,
};
