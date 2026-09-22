const crypto = require('crypto');
const { createCaptchaImages } = require('./imageGenerator');

const fs = require('fs');
const path = require('path');

// 32-byte persistent secret key for AES-256-GCM
function getSecretKey() {
  if (process.env.CAPTCHA_SECRET) {
    return crypto.createHash('sha256').update(process.env.CAPTCHA_SECRET).digest();
  }
  const secretPath = path.join(__dirname, '..', '.captcha-secret');
  try {
    if (fs.existsSync(secretPath)) {
      return Buffer.from(fs.readFileSync(secretPath, 'utf8').trim(), 'hex');
    }
  } catch (_) {}

  const newKey = crypto.randomBytes(32);
  try {
    fs.writeFileSync(secretPath, newKey.toString('hex'), 'utf8');
  } catch (_) {}
  return newKey;
}

const SECRET_KEY = getSecretKey();

const ALGORITHM = 'aes-256-gcm';
const TOKEN_TTL_MS = 2 * 60 * 1000;         // 2 minutes to solve
const MIN_SOLVE_TIME_MS = 300;               // Reject solves faster than humanly possible (300ms)
const TOLERANCE_PX = 5;                     // Allowable pixel offset error
const VERIFY_PASS_TTL_MS = 10 * 60 * 1000;  // 10 minutes pass validity

// Used challenge IDs cache to prevent replay attacks
const consumedChallenges = new Set();

// Periodically clean up consumed challenges cache
const cleanupInterval = setInterval(() => {
  consumedChallenges.clear();
}, TOKEN_TTL_MS);
if (cleanupInterval.unref) cleanupInterval.unref();

/**
 * Encrypts an object into a secure base64url token with AES-256-GCM
 */
function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  const jsonStr = JSON.stringify(payload);
  
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64url');
  encrypted += cipher.final('base64url');
  
  const tag = cipher.getAuthTag().toString('base64url');
  return `${iv.toString('base64url')}.${tag}.${encrypted}`;
}

/**
 * Decrypts and authenticates a base64url AES-256-GCM token
 */
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

/**
 * Creates a new slider puzzle challenge with server-rendered images
 */
function createChallenge() {
  const challengeId = crypto.randomUUID();
  const timestamp = Date.now();
  
  const canvasWidth = 340;
  const canvasHeight = 180;
  const pieceSize = 44;
  
  // Choose random position for the target slot
  const minX = 70;
  const maxX = canvasWidth - pieceSize - 20;
  const targetX = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
  
  const minY = 25;
  const maxY = canvasHeight - pieceSize - 25;
  const targetY = Math.floor(Math.random() * (maxY - minY + 1)) + minY;

  const theme = Math.floor(Math.random() * 4);
  const seed = Math.floor(Math.random() * 1000000);

  // Generate the background image with slot and the transparent piece image
  const { bgImage, pieceImage } = createCaptchaImages({
    width: canvasWidth,
    height: canvasHeight,
    targetX,
    targetY,
    theme,
    seed
  });

  // TargetX is strictly sealed inside AES-256-GCM token; client cannot inspect it
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

/**
 * Evaluates human movement dynamics and entropy
 */
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

  // Mechanical bots often output fixed velocity
  if (speeds.length > 8 && speedVariance < 0.00005) {
    return { isHuman: false, reason: 'Mechanical motion profile detected' };
  }

  return { isHuman: true, duration, points: trail.length };
}

/**
 * Verifies a challenge solution submitted by the user
 */
function verifyChallenge({ challengeToken, userX, trail }) {
  if (!challengeToken || typeof userX !== 'number') {
    return { success: false, message: 'Missing challenge parameters' };
  }

  const payload = decryptPayload(challengeToken);
  if (!payload) {
    return { success: false, message: 'Invalid or forged challenge token' };
  }

  const { challengeId, targetX, timestamp } = payload;

  // Check replay
  if (consumedChallenges.has(challengeId)) {
    return { success: false, message: 'Challenge token already used' };
  }

  // Check expiration
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) {
    return { success: false, message: 'Challenge expired. Please refresh.' };
  }

  // Mark consumed
  consumedChallenges.add(challengeId);

  // Check human interaction dynamics
  const entropy = evaluateTrailEntropy(trail);
  if (!entropy.isHuman) {
    return { 
      success: false, 
      message: `Verification rejected: ${entropy.reason}` 
    };
  }

  // Check offset accuracy
  const offsetDiff = Math.abs(userX - targetX);
  if (offsetDiff > TOLERANCE_PX) {
    return { 
      success: false, 
      message: `Slider alignment missed by ${offsetDiff.toFixed(1)}px (tolerance: ${TOLERANCE_PX}px)` 
    };
  }

  // Generate pass token
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

/**
 * Validates a passToken to protect downstream endpoints
 */
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
  validatePassToken,
  SECRET_KEY
};
