import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyStaticCadenceRegime,
  extractPrimaryWeaponInfo,
  findHeroPrimaryWeaponBindings,
  findSelectableHeroPrimaryWeaponBindings
} from '../src/player-state/primary-weapon-resource.mjs';

test('finds hero primary weapon binding and preserves EFireRate special scaling', () => {
  const artifact = {
    nested: [{
      heroId: 25,
      displayName: 'Warden',
      internalKey: 'warden',
      boundAbilities: { ESlot_Weapon_Primary: 'citadel_weapon_warden_set' },
      scalingStats: [{ recordKey: 'EFireRate', scalingStat: 'ETechPower', scale: 0.25 }]
    }]
  };
  const rows = findHeroPrimaryWeaponBindings(artifact);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].primaryWeaponRecordKey, 'citadel_weapon_warden_set');
  assert.deepEqual(rows[0].fireRateScaling, [{ scalingStat: 'ETechPower', scale: 0.25 }]);
});

test('extracts weapon cadence and operation fields from nested vdata text', () => {
  const text = `m_WeaponInfo = {\n m_iClipSize = 12\n m_flCycleTime = 0.25\n m_iBurstShotCount = 3\n m_flIntraBurstCycleTime = 0.06\n m_bSpinsUp = false\n m_flBulletSpeed = 5000\n}`;
  const row = extractPrimaryWeaponInfo(text);
  assert.equal(row.fields.m_iClipSize, 12);
  assert.equal(row.fields.m_flCycleTime, 0.25);
  assert.equal(row.fields.m_iBurstShotCount, 3);
  assert.equal(row.fields.m_flIntraBurstCycleTime, 0.06);
  assert.equal(row.cadenceRegime.regime, 'BURST');
});

test('single-shot records do not treat nonzero intra-burst time as the primary cycle', () => {
  const row = classifyStaticCadenceRegime({
    m_iBurstShotCount: 1,
    m_flCycleTime: 0.63,
    m_flIntraBurstCycleTime: 0.05,
    m_bSpinsUp: false
  });
  assert.equal(row.regime, 'SINGLE_OR_AUTOMATIC_NON_BURST');
  assert.equal(row.cycleTimeSeconds, 0.63);
  assert.equal(row.intraBurstCycleTimeSeconds, 0.05);
});

test('spin-up flag takes precedence over non-burst static classification', () => {
  const row = classifyStaticCadenceRegime({
    m_iBurstShotCount: 1,
    m_flCycleTime: 0.1,
    m_bSpinsUp: true
  });
  assert.equal(row.regime, 'SPIN_UP');
});


test('selectable binding selector excludes Script131 unresolved/non-selectable records', () => {
  const selectable = {
    heroId: 1,
    displayName: 'Selectable',
    internalKey: 'selectable',
    playerSelectable: true,
    boundAbilities: { ESlot_Weapon_Primary: 'weapon_selectable' },
    scalingStats: []
  };
  const unresolved = {
    heroId: 99,
    displayName: 'Unresolved',
    internalKey: 'unresolved',
    playerSelectable: null,
    boundAbilities: { ESlot_Weapon_Primary: 'weapon_unresolved' },
    scalingStats: []
  };
  const artifact = {
    heroes: [selectable],
    unresolvedSelectableState: [unresolved]
  };

  assert.equal(findHeroPrimaryWeaponBindings(artifact).length, 2);

  const strict = findSelectableHeroPrimaryWeaponBindings(artifact);
  assert.equal(strict.length, 1);
  assert.equal(strict[0].heroId, 1);
  assert.equal(strict[0].primaryWeaponRecordKey, 'weapon_selectable');
});
