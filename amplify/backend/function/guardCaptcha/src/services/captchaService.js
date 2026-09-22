const { createCaptchaImages, encodePng } = require('./imageGenerator');
const crypto = require('crypto');

// In Lambda, CAPTCHA_SECRET should be set in AWS Amplify Environment Variables
const SECRET_KEY = process.env.CAPTCHA_SECRET 
  ? crypto.createHash('sha256').update(process.env.CAPTCHA_SECRET).digest()
  : crypto.createHash('sha256').update('guard-amplify-default-secret-key-replace-in-prod').digest();

const ALGORITHM = 'aes-256-gcm';
const TOKEN_TTL_MS = 2 * 60 * 1000;         // 2 minutes to solve
const MIN_SOLVE_TIME_MS = 300;               // Reject solves faster than 300ms
const TOLERANCE_PX = 5;                     // Allowable pixel offset error
const VERIFY_PASS_TTL_MS = 10 * 60 * 1000;  // 10 minutes pass validity

const consumedChallenges = new Set();
const cleanupInterval = setInterval(() => {
  consumedChallenges.clear();
}, TOKEN_TTL_MS);
if (cleanupInterval.unref) cleanupInterval.unref();

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  const jsonStr = JSON.stringify(payload);
  
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64url');
  encrypted += cipher.final('base64url');
  
  const tag = cipher.getAuthTag().toString('base64url');
  return `${iv.toString('base64url')}.${tag}.${encrypted}`;
}

function decryptPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [ivB64, tagB64, encData] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encData, 'base64url', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

function createChallenge() {
  const challengeId = crypto.randomUUID();
  const timestamp = Date.now();
  
  const canvasWidth = 340;
  const canvasHeight = 180;
  const pieceSize = 44;
  
  const minX = 70;
  const maxX = canvasWidth - pieceSize - 20;
  const targetX = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
  
  const minY = 25;
  const maxY = canvasHeight - pieceSize - 25;
  const targetY = Math.floor(Math.random() * (maxY - minY + 1)) + minY;

  const theme = Math.floor(Math.random() * 4);
  const seed = Math.floor(Math.random() * 1000000);

  const { bgImage, pieceImage } = createCaptchaImages({
    width: canvasWidth,
    height: canvasHeight,
    targetX,
    targetY,
    theme,
    seed
  });

  const secretPayload = {
    challengeId,
    targetX,
    targetY,
    timestamp
  };

  const challengeToken = encryptPayload(secretPayload);

  return {
    challengeToken,
    bgImage,
    pieceImage,
    targetY,
    canvasWidth,
    canvasHeight,
    pieceSize
  };
}

function evaluateTrailEntropy(trail) {
  if (!Array.isArray(trail) || trail.length < 5) {
    return { isHuman: false, reason: 'Insufficient interaction telemetry' };
  }

  const startTime = trail[0].t;
  const endTime = trail[trail.length - 1].t;
  const duration = endTime - startTime;

  if (duration < MIN_SOLVE_TIME_MS) {
    return { isHuman: false, reason: 'Interaction completed too fast for human' };
  }

  let totalDistance = 0;
  let previousPoint = trail[0];
  const speeds = [];

  for (let i = 1; i < trail.length; i++) {
    const pt = trail[i];
    const dx = pt.x - previousPoint.x;
    const dy = pt.y - previousPoint.y;
    const dt = Math.max(pt.t - previousPoint.t, 1);
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    totalDistance += dist;
    speeds.push(dist / dt);

    previousPoint = pt;
  }

  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const speedVariance = speeds.reduce((acc, s) => acc + Math.pow(s - avgSpeed, 2), 0) / speeds.length;

  if (speeds.length > 8 && speedVariance < 0.00005) {
    return { isHuman: false, reason: 'Mechanical motion profile detected' };
  }

  return { isHuman: true, duration, points: trail.length };
}

function verifyChallenge({ challengeToken, userX, trail }) {
  if (!challengeToken || typeof userX !== 'number') {
    return { success: false, message: 'Missing challenge parameters' };
  }

  const payload = decryptPayload(challengeToken);
  if (!payload) {
    return { success: false, message: 'Invalid or forged challenge token' };
  }

  const { challengeId, targetX, timestamp } = payload;

  if (consumedChallenges.has(challengeId)) {
    return { success: false, message: 'Challenge token already used' };
  }

  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) {
    return { success: false, message: 'Challenge expired. Please refresh.' };
  }

  consumedChallenges.add(challengeId);

  const entropy = evaluateTrailEntropy(trail);
  if (!entropy.isHuman) {
    return { 
      success: false, 
      message: `Verification rejected: ${entropy.reason}` 
    };
  }

  const offsetDiff = Math.abs(userX - targetX);
  if (offsetDiff > TOLERANCE_PX) {
    return { 
      success: false, 
      message: `Slider alignment missed by ${offsetDiff.toFixed(1)}px (tolerance: ${TOLERANCE_PX}px)` 
    };
  }

  const passPayload = {
    verified: true,
    challengeId,
    iat: now,
    exp: now + VERIFY_PASS_TTL_MS
  };

  const passToken = encryptPayload(passPayload);

  return {
    success: true,
    message: 'Verification successful. Access granted.',
    passToken,
    expiresIn: VERIFY_PASS_TTL_MS / 1000
  };
}

function validatePassToken(passToken) {
  if (!passToken) return false;
  const payload = decryptPayload(passToken);
  if (!payload || !payload.verified) return false;
  if (Date.now() > payload.exp) return false;
  return true;
}

module.exports = {
  createChallenge,
  verifyChallenge,
  validatePassToken
};
