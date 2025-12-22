class AppError extends Error {
  constructor(code, message, details = {}, retryable = false) {
    super(message);
    this.code = code;
    this.details = details;
    this.retryable = !!retryable;
  }
}

function mapErrorToExitCode(code) {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 10;
    case 'INPUT_NOT_FOUND':
    case 'UNSUPPORTED_FORMAT':
      return 20;
    case 'COMFYUI_TIMEOUT':
    case 'COMFYUI_BAD_RESPONSE':
    case 'COMFYUI_UNAVAILABLE':
      return 30;
    case 'LIPSYNC_FAILED':
      return 40;
    case 'FFMPEG_FAILED':
      return 50;
    case 'OUTPUT_WRITE_FAILED':
      return 60;
    default:
      return 70;
  }
}

function errorResponse(err) {
  return {
    code: err.code || 'UNKNOWN_ERROR',
    message: err.message || 'unexpected error',
    details: err.details || null,
    retryable: !!err.retryable,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { AppError, mapErrorToExitCode, errorResponse };
