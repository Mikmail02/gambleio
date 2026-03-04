/**
 * Case Battle – Provably Fair roll for Jackpot (and optional future use).
 * Server seed (secret until reveal), client seed (player-provided or random), nonce.
 * HMAC-SHA256(serverSeed, clientSeed + nonce) → hex → first 8 chars → uint32 → [0, 1).
 */

const crypto = require('crypto');

/**
 * Generate a new server seed (hex, store this and reveal after round).
 * @returns {string} 64-char hex
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Compute HMAC-SHA256(serverSeed, clientSeed + ':' + nonce), return hex.
 * @param {string} serverSeed - hex
 * @param {string} clientSeed
 * @param {number} nonce
 * @returns {string} 64-char hex
 */
function hashRound(serverSeed, clientSeed, nonce) {
  const msg = clientSeed + ':' + String(nonce);
  return crypto.createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(msg).digest('hex');
}

/**
 * Convert hex string (first 8 chars) to float in [0, 1).
 * @param {string} hex - at least 8 chars
 * @returns {number} in [0, 1)
 */
function hexToFloat01(hex) {
  const sub = (hex || '00000000').slice(0, 8);
  const u = parseInt(sub, 16);
  return u / 0x100000000;
}

/**
 * Provably fair roll in [0, 1) for a battle round.
 * @param {string} serverSeed - hex
 * @param {string} clientSeed
 * @param {number} nonce
 * @returns {number} in [0, 1)
 */
function roll01(serverSeed, clientSeed, nonce) {
  const h = hashRound(serverSeed, clientSeed, nonce);
  return hexToFloat01(h);
}

/**
 * Full proof object for verification (client can recompute hash and float).
 * @param {string} serverSeed - hex (revealed after round)
 * @param {string} clientSeed
 * @param {number} nonce
 * @returns {{ serverSeed, clientSeed, nonce, hash: string, roll: number }}
 */
function getProof(serverSeed, clientSeed, nonce) {
  const h = hashRound(serverSeed, clientSeed, nonce);
  const roll = hexToFloat01(h);
  return { serverSeed, clientSeed, nonce, hash: h, roll };
}

module.exports = {
  generateServerSeed,
  hashRound,
  hexToFloat01,
  roll01,
  getProof,
};
