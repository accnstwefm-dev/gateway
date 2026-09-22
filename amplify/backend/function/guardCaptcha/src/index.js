/**
 * AWS Amplify Serverless Function Entry Point: guardCaptcha
 */
const { createChallenge, verifyChallenge, validatePassToken } = require('./services/captchaService');

exports.handler = async (event) => {
  // Support API Gateway v1 (REST API / proxy), v2 (HTTP API), and direct Lambda invoke
  const path = event.path || event.rawPath || '';
  const httpMethod = (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Captcha-Token,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST'
  };

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // 1. GET /api/captcha/create or /captcha/create
    if (httpMethod === 'GET' && (path.endsWith('/create') || path.endsWith('/create/'))) {
      const challenge = createChallenge();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, ...challenge })
      };
    }

    // 2. POST /api/captcha/verify or /captcha/verify
    if (httpMethod === 'POST' && (path.endsWith('/verify') || path.endsWith('/verify/'))) {
      let body = {};
      if (event.body) {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      }

      const { challengeToken, userX, trail } = body;
      const result = verifyChallenge({ challengeToken, userX, trail });

      // If passing, set secure cookie header if running via custom domain / API Gateway
      const responseHeaders = { ...headers };
      if (result.success && result.passToken) {
        responseHeaders['Set-Cookie'] = `captcha_token=${result.passToken}; Path=/; Max-Age=${result.expiresIn}; SameSite=Lax; Secure; HttpOnly`;
      }

      return {
        statusCode: result.success ? 200 : 400,
        headers: responseHeaders,
        body: JSON.stringify(result)
      };
    }

    // 3. GET /api/protected/content - Guarded downstream demonstration
    if (httpMethod === 'GET' && path.endsWith('/content')) {
      const passToken = event.headers?.['x-captcha-token'] || 
                        event.headers?.['X-Captcha-Token'] ||
                        (event.cookies && event.cookies.find(c => c.startsWith('captcha_token='))?.split('=')[1]);

      if (!passToken || !validatePassToken(passToken)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            error: 'CAPTCHA_REQUIRED',
            message: 'Access restricted. Please solve the puzzle challenge.'
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          authorized: true,
          message: 'Welcome to the protected resource on AWS Amplify!',
          timestamp: new Date().toISOString()
        })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'NOT_FOUND', message: `Route ${path} not found` })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'INTERNAL_ERROR', message: error.message })
    };
  }
};
