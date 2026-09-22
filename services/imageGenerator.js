const zlib = require('zlib');

// Precomputed CRC32 table for ultra-fast PNG chunk generation
const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crcVal = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crcVal, 8 + len);
  return buf;
}

function encodePng(width, height, rgbaBuffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // Color type 6 (RGBA)
  ihdr[10] = 0; // Deflate compression
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace method
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc(height * (1 + rowBytes));
  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    scanlines[dstOffset++] = 0; // Filter byte
    rgbaBuffer.copy(scanlines, dstOffset, srcOffset, srcOffset + rowBytes);
    dstOffset += rowBytes;
    srcOffset += rowBytes;
  }

  const compressed = zlib.deflateSync(scanlines, { level: 6 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Checks if a pixel (px, py) within a 44x44 box falls inside the classic jigsaw puzzle piece
 */
function isInsidePuzzlePiece(px, py) {
  // Base square: 8 to 36
  const inSquare = px >= 8 && px <= 36 && py >= 8 && py <= 36;
  const inTopTab = Math.hypot(px - 22, py - 8) <= 6.5;
  const inRightTab = Math.hypot(px - 36, py - 22) <= 6.5;
  const inBottomHole = Math.hypot(px - 22, py - 36) <= 6.5;
  const inLeftHole = Math.hypot(px - 8, py - 22) <= 6.5;

  if (inBottomHole || inLeftHole) return false;
  if (inSquare || inTopTab || inRightTab) return true;
  return false;
}

/**
 * Checks if a pixel is near the boundary of the puzzle piece
 */
function isPuzzleBorder(px, py) {
  if (!isInsidePuzzlePiece(px, py)) return false;
  // Border if any neighbor within 1 pixel is outside
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!isInsidePuzzlePiece(px + dx, py + dy)) return true;
    }
  }
  return false;
}

/**
 * Generates procedural background pixels
 */
function generateBackgroundRgba(width, height, theme, seed) {
  const buf = Buffer.alloc(width * height * 4);
  const prng = (s) => {
    const x = Math.sin(s++) * 10000;
    return x - Math.floor(x);
  };

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * 4;

      let r = 20, g = 25, b = 40;

      switch (theme % 4) {
        case 0: // Cyberpunk Aurora
          r = Math.floor(25 + 90 * Math.sin(nx * 3 + ny * 2 + seed));
          g = Math.floor(20 + 70 * Math.cos(nx * 2 - ny * 3));
          b = Math.floor(60 + 160 * (1 - ny * 0.7));
          // Glow curve
          const wave1 = Math.sin(nx * 6 + ny * 3) * 0.2 + 0.5;
          if (Math.abs(ny - wave1) < 0.08) {
            r = Math.min(255, r + 110);
            g = Math.min(255, g + 160);
            b = Math.min(255, b + 220);
          }
          break;

        case 1: // Sunset Horizon
          r = Math.floor(240 * (1 - ny * 0.5) + 30 * Math.sin(nx * 4));
          g = Math.floor(80 * (1 - ny) + 40 * Math.sin(nx * 2));
          b = Math.floor(60 * (1 - ny) + 120 * ny);
          // Sun disc
          const sunDist = Math.hypot(nx - 0.5, ny - 0.45);
          if (sunDist < 0.22) {
            r = 255;
            g = Math.floor(220 * (1 - sunDist / 0.22));
            b = Math.floor(140 * (1 - sunDist / 0.22));
          }
          // Mountains
          const mountain = 0.65 + 0.1 * Math.sin(nx * 10 + seed) + 0.05 * Math.cos(nx * 22);
          if (ny > mountain) {
            r = Math.floor(r * 0.25);
            g = Math.floor(g * 0.2);
            b = Math.floor(b * 0.35);
          }
          break;

        case 2: // Cosmic Nebula
          r = Math.floor(15 + 45 * Math.sin(nx * 5 + seed));
          g = Math.floor(25 + 50 * Math.cos(ny * 4));
          b = Math.floor(55 + 90 * Math.sin((nx + ny) * 3));
          // Star dust
          if (prng(x * 1337 + y * 7919 + seed) > 0.985) {
            r = Math.min(255, r + 200);
            g = Math.min(255, g + 210);
            b = 255;
          }
          break;

        default: // Emerald Grid / Tech Horizon
          r = Math.floor(10 + 30 * ny);
          g = Math.floor(40 + 130 * (1 - ny * 0.4));
          b = Math.floor(45 + 100 * Math.sin(nx * 3));
          // Subtle grid pattern
          if (x % 34 === 0 || y % 30 === 0) {
            g = Math.min(255, g + 45);
            b = Math.min(255, b + 45);
          }
          break;
      }

      buf[idx] = Math.max(0, Math.min(255, r));
      buf[idx + 1] = Math.max(0, Math.min(255, g));
      buf[idx + 2] = Math.max(0, Math.min(255, b));
      buf[idx + 3] = 255; // Fully opaque
    }
  }

  return buf;
}

/**
 * Creates the CAPTCHA image pair:
 * 1. bgPngBase64: Background image with dark cutout slot and border at (targetX, targetY)
 * 2. piecePngBase64: 44x44 PNG containing the excised puzzle piece with transparent background
 */
function createCaptchaImages({ width = 340, height = 180, targetX, targetY, theme = 0, seed = 12345 }) {
  const bgBuffer = generateBackgroundRgba(width, height, theme, seed);
  const pieceSize = 44;
  const pieceBuffer = Buffer.alloc(pieceSize * pieceSize * 4, 0); // Transparent by default

  // Carve the piece and slot
  for (let py = 0; py < pieceSize; py++) {
    for (let px = 0; px < pieceSize; px++) {
      const isInside = isInsidePuzzlePiece(px, py);
      if (!isInside) continue;

      const isBorder = isPuzzleBorder(px, py);
      const pieceIdx = (py * pieceSize + px) * 4;

      const bgX = targetX + px;
      const bgY = targetY + py;

      if (bgX >= 0 && bgX < width && bgY >= 0 && bgY < height) {
        const bgIdx = (bgY * width + bgX) * 4;

        // Copy source pixels to the piece
        pieceBuffer[pieceIdx] = bgBuffer[bgIdx];
        pieceBuffer[pieceIdx + 1] = bgBuffer[bgIdx + 1];
        pieceBuffer[pieceIdx + 2] = bgBuffer[bgIdx + 2];
        pieceBuffer[pieceIdx + 3] = 255;

        // If border pixel, highlight the piece edge
        if (isBorder) {
          pieceBuffer[pieceIdx] = Math.min(255, pieceBuffer[pieceIdx] + 80);
          pieceBuffer[pieceIdx + 1] = Math.min(255, pieceBuffer[pieceIdx + 1] + 80);
          pieceBuffer[pieceIdx + 2] = Math.min(255, pieceBuffer[pieceIdx + 2] + 80);
        }

        // Darken the slot in the background
        if (isBorder) {
          // Bright outline for the slot
          bgBuffer[bgIdx] = 255;
          bgBuffer[bgIdx + 1] = 255;
          bgBuffer[bgIdx + 2] = 255;
        } else {
          // Dark recessed slot
          bgBuffer[bgIdx] = Math.floor(bgBuffer[bgIdx] * 0.22);
          bgBuffer[bgIdx + 1] = Math.floor(bgBuffer[bgIdx + 1] * 0.22);
          bgBuffer[bgIdx + 2] = Math.floor(bgBuffer[bgIdx + 2] * 0.22);
        }
      }
    }
  }

  const bgPng = encodePng(width, height, bgBuffer);
  const piecePng = encodePng(pieceSize, pieceSize, pieceBuffer);

  return {
    bgImage: `data:image/png;base64,${bgPng.toString('base64')}`,
    pieceImage: `data:image/png;base64,${piecePng.toString('base64')}`,
    pieceSize
  };
}

module.exports = {
  createCaptchaImages,
  encodePng
};
