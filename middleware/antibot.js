const { validatePassToken } = require('../services/captchaService');

// In-memory sliding window IP store for rate limiting
const ipRequestBuckets = new Map();

// Known automated scraper / attack agent patterns
const BOT_UA_PATTERNS = [
  /headless/i,
  /phantomjs/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /sqlmap/i,
  /nikto/i,
  /zgrab/i,
  /masscan/i
];

/**
 * IP Sliding Window Rate Limiter
 * @param {Object} options - { windowMs, maxRequests }
 */
function rateLimiter(options = { windowMs: 60000, maxRequests: 60 }) {
  const { windowMs, maxRequests } = options;

  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
               req.socket.remoteAddress || 
               'unknown';
    const now = Date.now();

    if (!ipRequestBuckets.has(ip)) {
      ipRequestBuckets.set(ip, []);
    }

    const timestamps = ipRequestBuckets.get(ip);
    
    // Filter out timestamps outside window
    const validTimestamps = timestamps.filter(t => now - t < windowMs);
    validTimestamps.push(now);
    ipRequestBuckets.set(ip, validTimestamps);

    if (validTimestamps.length > maxRequests) {
      const oldest = validTimestamps[0];
      const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Please slow down and try again.',
        retryAfter: retryAfterSeconds
      });
    }

    next();
  };
}

/**
 * Basic Anti-Bot and Scanner Header Inspection
 */
function botHeaderInspector(req, res, next) {
  const userAgent = req.headers['user-agent'] || '';

  // Block requests with no User-Agent
  if (!userAgent || userAgent.trim().length === 0) {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Suspicious request profile (missing client signature).'
    });
  }

  // Block known automated attack tooling
  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(userAgent)) {
      return res.status(403).json({
        error: 'BOT_DETECTED',
        message: 'Automated agent signature blocked.'
      });
    }
  }

  next();
}

/**
 * Route protection middleware requiring valid human captcha pass token
 */
function requireCaptchaPass(req, res, next) {
  const token = req.headers['x-captcha-token'] || 
                req.cookies?.captcha_token || 
                req.body?.captchaToken;

  if (!token || !validatePassToken(token)) {
    return res.status(403).json({
      error: 'CAPTCHA_REQUIRED',
      message: 'Access restricted. Please complete the slider verification.'
    });
  }

  next();
}

// Clean up stale IP records every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipRequestBuckets.entries()) {
    const fresh = timestamps.filter(t => now - t < 120000);
    if (fresh.length === 0) {
      ipRequestBuckets.delete(ip);
    } else {
      ipRequestBuckets.set(ip, fresh);
    }
  }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

module.exports = {
  rateLimiter,
  botHeaderInspector,
  requireCaptchaPass
};
