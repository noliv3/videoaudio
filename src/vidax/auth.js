function createAuthMiddleware(config) {
  const apiKey = process.env.VIDAX_API_KEY || config.apiKey;
  return (req, res, next) => {
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    const provided = req.get('X-API-Key');
    if (!provided || provided !== apiKey) {
      return res.status(401).json({ error: 'invalid api key' });
    }
    next();
  };
}

module.exports = createAuthMiddleware;
