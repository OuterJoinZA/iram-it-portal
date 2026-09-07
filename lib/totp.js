// ──────────────────────────────────────────────────────────────────────────────
// TOTP (RFC 6238) over HMAC-SHA1, plus RFC 4648 base32 — both hand-rolled on
// Node's built-in crypto/Buffer so this needs no new dependency. Compatible
// with Google Authenticator, Microsoft Authenticator, Authy, etc.
//
// No QR code image — the setup screen shows the secret and otpauth:// URI as
// text; every authenticator app has an "enter setup key manually" option that
// takes exactly this. Avoids pulling in a QR/image-rendering dependency for a
// small internal tool.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS       = 6;
const B32_ALPHABET  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '', out = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += B32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret, standard for TOTP
}

function otpauthUrl(secret, username, issuer = 'iRam IT Portal') {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

/** Accepts the current 30s step and ±1 step either side, to tolerate clock drift. */
function verifyTotp(secret, code) {
  if (!secret || !code || !/^\d{6}$/.test(String(code))) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift++) {
    const expected = hotp(secret, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(code));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

module.exports = { generateSecret, otpauthUrl, verifyTotp };
