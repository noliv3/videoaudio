const { AppError, errorResponse } = require('../errors');

function createAuthMiddleware(config, injectedKey) {
  const apiKey = injectedKey || process.env.VIDAX_API_KEY || (config ? config.apiKey : null);
  return (req, res, next) => {
    if (!apiKey) {
      const err = new AppError('AUTH_CONFIGURATION', 'API key not configured');
      return res.status(401).json(errorResponse(err));
    }
    const provided = req.get('X-API-Key');
    if (!provided) {
      const err = new AppError('AUTH_MISSING', 'missing api key');
      return res.status(401).json(errorResponse(err));
    }
    if (provided !== apiKey) {
      const err = new AppError('AUTH_FORBIDDEN', 'invalid api key');
      return res.status(403).json(errorResponse(err));
    }
    next();
  };
}

module.exports = createAuthMiddleware;
