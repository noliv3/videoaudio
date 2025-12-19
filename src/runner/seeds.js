const crypto = require('crypto');

const MIN_SEED = 0;
const MAX_SEED = 0xffffffff;

function normalizeSeed(value) {
  if (value == null) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(numeric) || Number.isNaN(numeric)) {
    throw new Error('Seed must be an integer');
  }
  if (!Number.isFinite(numeric)) {
    throw new Error('Seed must be a finite integer');
  }
  if (numeric < MIN_SEED || numeric > MAX_SEED) {
    throw new Error(`Seed must be between ${MIN_SEED} and ${MAX_SEED}`);
  }
  return numeric;
}

function generateSeed() {
  return crypto.randomInt(MIN_SEED, MAX_SEED + 1);
}

module.exports = {
  MIN_SEED,
  MAX_SEED,
  generateSeed,
  normalizeSeed,
};
