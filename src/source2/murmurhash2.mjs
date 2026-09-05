// Source 2 string-token hashing used by Deadlock asset/item IDs.
// Deadlock asset tooling computes item IDs as MurmurHash2(class_name, 0x31415926).

export const DEADLOCK_STRING_TOKEN_SEED = 0x31415926;

export function murmurHash2(input, seed = DEADLOCK_STRING_TOKEN_SEED) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const m = 0x5bd1e995;
  const r = 24;

  let h = (seed ^ bytes.length) >>> 0;
  let offset = 0;
  let remaining = bytes.length;

  while (remaining >= 4) {
    let k = (
      bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24)
    ) >>> 0;

    k = Math.imul(k, m) >>> 0;
    k ^= k >>> r;
    k = Math.imul(k, m) >>> 0;

    h = Math.imul(h, m) >>> 0;
    h ^= k;

    offset += 4;
    remaining -= 4;
  }

  if (remaining === 3) h ^= bytes[offset + 2] << 16;
  if (remaining >= 2) h ^= bytes[offset + 1] << 8;
  if (remaining >= 1) {
    h ^= bytes[offset];
    h = Math.imul(h, m) >>> 0;
  }

  h ^= h >>> 13;
  h = Math.imul(h, m) >>> 0;
  h ^= h >>> 15;

  return h >>> 0;
}

export function buildDeadlockStringTokenIndex(recordKeys) {
  const byId = new Map();
  const collisions = [];

  for (const recordKey of recordKeys) {
    const id = murmurHash2(recordKey);
    const existing = byId.get(id);
    if (existing && existing !== recordKey) {
      collisions.push({ id, recordKeys: [existing, recordKey] });
      continue;
    }
    byId.set(id, recordKey);
  }

  return { byId, collisions };
}
