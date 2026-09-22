/**
 * AWS Amplify / AWS Lambda Function Handler
 * Compatible with API Gateway HTTP APIs (Payload format 2.0 and 1.0)
 */
const { createChallenge, verifyChallenge, validatePassToken } = require('./services/captchaService');

exports.handler = async (event) => {
  const path = event.rawPath || event.path || '';
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Captcha-Token,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST'
  };

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // 1. Create Challenge: GET /api/captcha/create
    if (method === 'GET' && path.endsWith('/create')) {
      const challenge = createChallenge();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, ...challenge })
      };
    }

    // 2. Verify Challenge: POST /api/captcha/verify
    if (method === 'POST' && path.endsWith('/verify')) {
      let body = {};
      if (event.body) {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      }

      const { challengeToken, userX, trail } = body;
      const result = verifyChallenge({ challengeToken, userX, trail });

      return {
        statusCode: result.success ? 200 : 400,
        headers,
        body: JSON.stringify(result)
      };
    }

    // 3. Protected Sample Route: GET /api/protected/content
    if (method === 'GET' && path.endsWith('/content')) {
      const passToken = event.headers?.['x-captcha-token'] || event.headers?.['X-Captcha-Token'];
      if (!passToken || !validatePassToken(passToken)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            error: 'CAPTCHA_REQUIRED',
            message: 'Access denied. Valid human verification required.'
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          authorized: true,
          message: 'Access granted via AWS Lambda function.'
        })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'NOT_FOUND', message: 'Endpoint not found' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
    };
  }
};
