import test from 'node:test';
import assert from 'node:assert/strict';

import { murmurHash2 } from '../src/source2/murmurhash2.mjs';
import {
  buildWorldBuffRuntimeSubclassMap,
  summarizeWorldBuffSubclassResolution,
} from '../src/resources/world-buff-runtime-subclass-map.mjs';

const fixture = {
  status: 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
  permanentPickups: {
    families: [
      {
        family: 'spirit_permanent_pickup',
        tiers: [
          {
            found: true,
            tier: 1,
            recordKey: 'spirit_permanent_pickup',
            modifierClass: 'modifier_permanent_pickup',
            effects: [{ modifierValue: 'MODIFIER_VALUE_TECH_POWER', value: 2 }],
          },
          {
            found: true,
            tier: 2,
            recordKey: 'spirit_permanent_pickup_lv2',
            modifierClass: 'modifier_permanent_pickup',
            effects: [{ modifierValue: 'MODIFIER_VALUE_TECH_POWER', value: 3 }],
          },
        ],
      },
    ],
  },
  bridgePowerups: {
    powerups: [
      {
        found: true,
        recordKey: 'gun_powerup_pickup',
        modifierClass: 'modifier_citadel_powerup_gun',
        durationSeconds: 160,
        effects: [],
      },
      {
        found: true,
        recordKey: 'survival_powerup_pickup',
        modifierClass: 'modifier_citadel_powerup_survival',
        durationSeconds: 160,
        effects: [],
      },
      {
        found: true,
        recordKey: 'casting_powerup_pickup',
        modifierClass: 'modifier_citadel_powerup_casting',
        durationSeconds: 160,
        effects: [],
      },
      {
        found: true,
        recordKey: 'movement_powerup_pickup',
        modifierClass: 'modifier_citadel_powerup_movement',
        durationSeconds: 160,
        effects: [],
      },
    ],
  },
};

test('builds compound EntitySubclassID_t candidates without changing the Script143 simple-token helper', () => {
  const map = buildWorldBuffRuntimeSubclassMap(fixture);
  assert.equal(map.collisions.length, 0);
  assert.ok(map.byToken.has('spirit_permanent_pickup/modifier_permanent_pickup'));
  assert.ok(map.byToken.has('spirit_permanent_pickup_lv2/modifier_permanent_pickup'));
  assert.ok(map.byToken.has('gun_powerup_pickup/modifier_citadel_powerup_gun'));
});

test('uses the established Deadlock MurmurHash2 convention on the full subclass path', () => {
  const map = buildWorldBuffRuntimeSubclassMap(fixture);
  const token = 'spirit_permanent_pickup/modifier_permanent_pickup';
  assert.equal(map.byToken.get(token).sourceId, murmurHash2(token));
});

test('regresses the Script143 observed permanent-pickup source IDs', () => {
  const map = buildWorldBuffRuntimeSubclassMap(fixture);
  assert.equal(
    map.byToken.get('spirit_permanent_pickup/modifier_permanent_pickup').sourceId,
    2201601853
  );
  assert.equal(
    map.byToken.get('spirit_permanent_pickup_lv2/modifier_permanent_pickup').sourceId,
    3992882918
  );

  const resolution = summarizeWorldBuffSubclassResolution(2201601853, map);
  assert.equal(resolution.matched, true);
  assert.deepEqual(resolution.buffClasses, ['PERMANENT_PICKUP']);
  assert.equal(resolution.candidates[0].recordKey, 'spirit_permanent_pickup');
});


test('regresses all four bridge-powerup compound subclass IDs used by Script147 carrier discovery', () => {
  const map = buildWorldBuffRuntimeSubclassMap(fixture);
  assert.equal(map.bridgeCandidates.length, 4);
  assert.deepEqual(
    Object.fromEntries(map.bridgeCandidates.map(row => [row.recordKey, row.sourceId])),
    {
      gun_powerup_pickup: 1193208184,
      survival_powerup_pickup: 2839730803,
      casting_powerup_pickup: 2290625079,
      movement_powerup_pickup: 3531556053,
    }
  );
});
