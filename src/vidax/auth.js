const { AppError, errorResponse } = require('../errors');

function createAuthMiddleware(config) {
  const apiKey = process.env.VIDAX_API_KEY || config.apiKey;
  return (req, res, next) => {
    if (!apiKey) {
      const err = new AppError('VALIDATION_ERROR', 'API key not configured');
      return res.status(401).json(errorResponse(err));
    }
    const provided = req.get('X-API-Key');
    if (!provided) {
      const err = new AppError('VALIDATION_ERROR', 'missing api key');
      return res.status(401).json(errorResponse(err));
    }
    if (provided !== apiKey) {
      const err = new AppError('VALIDATION_ERROR', 'invalid api key');
      return res.status(403).json(errorResponse(err));
    }
    next();
  };
}

module.exports = createAuthMiddleware;
