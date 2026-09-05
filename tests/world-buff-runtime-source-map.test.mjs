import test from 'node:test';
import assert from 'node:assert/strict';

import { murmurHash2 } from '../src/source2/murmurhash2.mjs';
import {
  buildWorldBuffRuntimeSourceMap,
  summarizeWorldBuffSourceResolution,
} from '../src/resources/world-buff-runtime-source-map.mjs';

const fixture = {
  status: 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
  permanentPickups: {
    families: [
      {
        family: 'spirit_permanent_pickup',
        tiers: [
          { found: true, tier: 1, recordKey: 'spirit_permanent_pickup', modifierClass: 'modifier_permanent_pickup' },
          { found: true, tier: 2, recordKey: 'spirit_permanent_pickup_lv2', modifierClass: 'modifier_permanent_pickup' },
        ],
      },
    ],
  },
  bridgePowerups: {
    powerups: [
      { found: true, recordKey: 'gun_powerup_pickup', modifierClass: 'modifier_citadel_powerup_gun' },
      { found: true, recordKey: 'movement_powerup_pickup', modifierClass: 'modifier_citadel_powerup_movement' },
    ],
  },
};

test('builds collision-aware permanent and bridge Source2 token candidates', () => {
  const sourceMap = buildWorldBuffRuntimeSourceMap(fixture);
  assert.equal(sourceMap.collisions.length, 0);
  assert.ok(sourceMap.byToken.has('modifier_permanent_pickup'));
  assert.ok(sourceMap.byToken.has('spirit_permanent_pickup_lv2'));
  assert.ok(sourceMap.byToken.has('modifier_citadel_powerup_gun'));
});

test('uses the established Source2 MurmurHash2 string-token convention', () => {
  const sourceMap = buildWorldBuffRuntimeSourceMap(fixture);
  assert.equal(sourceMap.byToken.get('modifier_permanent_pickup').sourceId, murmurHash2('modifier_permanent_pickup'));
  assert.equal(sourceMap.byToken.get('modifier_citadel_powerup_gun').sourceId, murmurHash2('modifier_citadel_powerup_gun'));
  assert.equal(sourceMap.byToken.get('modifier_citadel_powerup_movement').sourceId, murmurHash2('modifier_citadel_powerup_movement'));
});

test('resolves a runtime source ID without pretending repeated modifier-class candidates are collisions', () => {
  const sourceMap = buildWorldBuffRuntimeSourceMap(fixture);
  const id = murmurHash2('modifier_permanent_pickup');
  const resolution = summarizeWorldBuffSourceResolution(id, sourceMap);
  assert.equal(resolution.matched, true);
  assert.deepEqual(resolution.buffClasses, ['PERMANENT_PICKUP']);
  assert.ok(resolution.candidates.length >= 2);
});
