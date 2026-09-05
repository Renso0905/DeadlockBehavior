import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEADLOCK_STRING_TOKEN_SEED,
  murmurHash2,
  buildDeadlockStringTokenIndex,
} from '../src/source2/murmurhash2.mjs';

test('uses the Deadlock/Source2 item string-token seed', () => {
  assert.equal(DEADLOCK_STRING_TOKEN_SEED, 0x31415926);
});

test('matches a published Deadlock asset ID fixture', () => {
  assert.equal(murmurHash2('citadel_weapon_rutger_set'), 2470199706);
});

test('maps Mystic Expansion to the replay-observed item token', () => {
  assert.equal(murmurHash2('upgrade_magic_reach'), 754480263);
});

test('builds a collision-aware token index', () => {
  const index = buildDeadlockStringTokenIndex([
    'upgrade_magic_reach',
    'upgrade_crackshot',
    'upgrade_clip_size',
  ]);
  assert.equal(index.collisions.length, 0);
  assert.equal(index.byId.get(754480263), 'upgrade_magic_reach');
});
