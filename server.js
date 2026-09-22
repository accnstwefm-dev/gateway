const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createChallenge, verifyChallenge } = require('./services/captchaService');
const { rateLimiter, botHeaderInspector, requireCaptchaPass } = require('./middleware/antibot');

const app = express();
const PORT = process.env.PORT || 3000;

// Core Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Global bot signature check
app.use(botHeaderInspector);

// General rate limiter: 120 req/min
app.use(rateLimiter({ windowMs: 60000, maxRequests: 120 }));

/**
 * Health Check Endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'guard-captcha-antibot'
  });
});

/**
 * Endpoint to create a new slider CAPTCHA challenge
 * Stricter rate limit: 25 challenges/min per IP
 */
app.get('/api/captcha/create', rateLimiter({ windowMs: 60000, maxRequests: 25 }), (req, res) => {
  try {
    const challenge = createChallenge();
    res.json({
      success: true,
      ...challenge
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to initialize challenge' });
  }
});

/**
 * Endpoint to verify human solve
 * Stricter rate limit: 25 verifications/min per IP
 */
app.post('/api/captcha/verify', rateLimiter({ windowMs: 60000, maxRequests: 25 }), (req, res) => {
  try {
    const { challengeToken, userX, trail } = req.body;
    const result = verifyChallenge({ challengeToken, userX, trail });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Set secure HTTP-only cookie for the session
    res.cookie('captcha_token', result.passToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: result.expiresIn * 1000
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal verification error' });
  }
});

/**
 * Sample Protected Application Endpoint
 * Access is blocked unless the user has completed the slider challenge
 */
app.get('/api/protected/content', requireCaptchaPass, (req, res) => {
  res.json({
    authorized: true,
    message: 'Welcome! You have successfully passed the human anti-bot verification.',
    timestamp: new Date().toISOString(),
    protectedData: {
      accountTier: 'Verified Human',
      sessionStatus: 'Authenticated & Guarded',
      securityScore: 100
    }
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Guard] Antibot & Slider CAPTCHA server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
