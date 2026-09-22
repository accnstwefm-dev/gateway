const assert = require('assert');
const { createChallenge, verifyChallenge, validatePassToken, decryptPayload } = require('../services/captchaService');
const { handler: lambdaHandler } = require('../lambda');

console.log('--- Starting Slider CAPTCHA & Anti-Bot Verification Tests ---');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // 1. Challenge Generation
  let challenge;
  test('Challenge generation generates images and seals targetX', () => {
    challenge = createChallenge();
    assert.ok(challenge.challengeToken, 'Missing challengeToken');
    assert.ok(challenge.bgImage.startsWith('data:image/png;base64,'), 'bgImage is not PNG data URI');
    assert.ok(challenge.pieceImage.startsWith('data:image/png;base64,'), 'pieceImage is not PNG data URI');
    assert.strictEqual(typeof challenge.targetY, 'number', 'targetY should be a number');
    // Ensure targetX is not exposed to client
    assert.strictEqual(challenge.targetX, undefined, 'targetX must NEVER be exposed in challenge output');
  });

  // Extract true targetX by decrypting the token (for test simulation only)
  const crypto = require('crypto');
  // Helper to peek targetX using AES decipher for test harness
  const [ivB64, tagB64, encData] = challenge.challengeToken.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', require('../services/captchaService').SECRET_KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  let decryptedStr = decipher.update(encData, 'base64url', 'utf8');
  decryptedStr += decipher.final('utf8');
  const secretPayload = JSON.parse(decryptedStr);
  const correctTargetX = secretPayload.targetX;

  // 2. Successful Human Solve Simulation
  let humanPassToken;
  test('Human solve with realistic duration and natural jitter passes', () => {
    const startTime = Date.now() - 650; // 650ms duration
    const trail = [
      { x: 10, y: 50, t: startTime },
      { x: 35, y: 51, t: startTime + 100 },
      { x: 72, y: 53, t: startTime + 230 },
      { x: 110, y: 52, t: startTime + 380 },
      { x: 140, y: 54, t: startTime + 510 },
      { x: correctTargetX + 1, y: 52, t: startTime + 650 } // within 1px
    ];

    const result = verifyChallenge({
      challengeToken: challenge.challengeToken,
      userX: correctTargetX + 1,
      trail
    });

    assert.strictEqual(result.success, true, 'Verification should succeed');
    assert.ok(result.passToken, 'Should return a passToken');
    humanPassToken = result.passToken;
  });

  // 3. Replay Attack Prevention
  test('Replay attack is rejected when re-submitting same challenge', () => {
    const trail = [
      { x: 10, y: 50, t: Date.now() - 600 },
      { x: 50, y: 51, t: Date.now() - 400 },
      { x: 100, y: 52, t: Date.now() - 200 },
      { x: correctTargetX, y: 53, t: Date.now() }
    ];

    const result = verifyChallenge({
      challengeToken: challenge.challengeToken,
      userX: correctTargetX,
      trail
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('already used'), 'Should reject already used token');
  });

  // 4. Bot Speed Detection
  test('Bot instant solve (<300ms) is rejected', () => {
    const freshChallenge = createChallenge();
    const now = Date.now();
    const botTrail = [
      { x: 0, y: 50, t: now - 50 },
      { x: 50, y: 50, t: now - 30 },
      { x: 100, y: 50, t: now - 10 },
      { x: 150, y: 50, t: now },
      { x: 180, y: 50, t: now }
    ];

    const result = verifyChallenge({
      challengeToken: freshChallenge.challengeToken,
      userX: 180,
      trail: botTrail
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('too fast'), 'Should reject fast solver');
  });

  // 5. Bot Linear/Mechanical Velocity Profile
  test('Bot with mechanical motion (flat linear velocity) is rejected', () => {
    const freshChallenge = createChallenge();
    const now = Date.now();
    // 10 points spaced identically with identical constant delta
    const mechanicalTrail = [];
    for (let i = 0; i < 12; i++) {
      mechanicalTrail.push({
        x: i * 15,
        y: 50,
        t: now - 600 + i * 50
      });
    }

    const result = verifyChallenge({
      challengeToken: freshChallenge.challengeToken,
      userX: 165,
      trail: mechanicalTrail
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('Mechanical motion'), 'Should detect mechanical bot');
  });

  // 6. Inaccurate Offset Failure
  test('Incorrect slider alignment (>5px offset) is rejected', () => {
    const freshChallenge = createChallenge();
    const startTime = Date.now() - 700;
    const trail = [
      { x: 10, y: 50, t: startTime },
      { x: 40, y: 52, t: startTime + 150 },
      { x: 75, y: 51, t: startTime + 350 },
      { x: 120, y: 54, t: startTime + 550 },
      { x: 150, y: 53, t: startTime + 700 }
    ];

    const result = verifyChallenge({
      challengeToken: freshChallenge.challengeToken,
      userX: 20, // Way off target
      trail
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('missed'), 'Should indicate offset miss');
  });

  // 7. Pass Token Validation
  test('Valid pass token authorizes access to protected resources', () => {
    assert.strictEqual(validatePassToken(humanPassToken), true);
    assert.strictEqual(validatePassToken('invalid.token.structure'), false);
    assert.strictEqual(validatePassToken(null), false);
  });

  // 8. Serverless Lambda Handler
  await test('AWS Lambda handler responds correctly to create challenge event', async () => {
    const event = {
      rawPath: '/api/captcha/create',
      requestContext: { http: { method: 'GET' } }
    };
    const response = await lambdaHandler(event);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.challengeToken);
  });

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
