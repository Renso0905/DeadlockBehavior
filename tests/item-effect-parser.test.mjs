import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeItemEffectRecord,
    parseAbilityProperties,
    numericIfPlain,
    isMeaningfulProvidedStat
} from '../src/vdata/item-effect-parser.mjs';

test('parses direct provided item properties without inventing conditional semantics', () => {
    const record = `
      m_mapAbilityProperties = {
        FireRate = {
          m_strValue = "12"
          m_eProvidedPropertyType = "MODIFIER_VALUE_FIRE_RATE"
        }
        Cooldown = {
          m_strValue = "AbilityCooldown"
        }
      }
    `;

    const rows = parseAbilityProperties(record);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].providedPropertyType, 'MODIFIER_VALUE_FIRE_RATE');
    assert.equal(rows[0].numericValue, 12);
    assert.equal(rows[1].providedPropertyType, null);
    assert.equal(rows[1].numericValue, null);
});

test('separates direct provided tokens from non-direct modifier tokens', () => {
    const record = `
      m_mapAbilityProperties = {
        Ammo = {
          m_strValue = "20"
          m_eProvidedPropertyType = "MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT"
        }
      }
      m_BonusModifier = subclass: {
        _class = "modifier_example_proc"
        m_vecScriptValues = [
          {
            m_eModifierValue = "MODIFIER_VALUE_FIRE_RATE"
            m_value = 30
          }
        ]
      }
    `;

    const analyzed = analyzeItemEffectRecord(record);
    assert.deepEqual(analyzed.directProvidedTokens, [
        'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT'
    ]);
    assert.deepEqual(analyzed.nonDirectModifierTokens, [
        'MODIFIER_VALUE_FIRE_RATE'
    ]);
    assert.deepEqual(analyzed.nestedModifierClasses, [
        'modifier_example_proc'
    ]);
});

test('preserves formulas and symbolic values instead of coercing them to numbers', () => {
    assert.equal(numericIfPlain('15.5'), 15.5);
    assert.equal(numericIfPlain('AbilityCooldown'), null);
    assert.equal(numericIfPlain('10 + SpiritPower * 0.2'), null);
});


test('preserves same modifier token when it appears both direct and outside ability properties', () => {
    const record = `
      m_mapAbilityProperties = {
        FireRate = {
          m_strValue = "10"
          m_eProvidedPropertyType = "MODIFIER_VALUE_FIRE_RATE"
        }
      }
      m_ConditionalModifier = subclass: {
        _class = "modifier_conditional_fire_rate"
        m_vecScriptValues = [
          {
            m_eModifierValue = "MODIFIER_VALUE_FIRE_RATE"
            m_value = 25
          }
        ]
      }
    `;

    const analyzed = analyzeItemEffectRecord(record);
    assert.deepEqual(analyzed.directProvidedTokens, [
        'MODIFIER_VALUE_FIRE_RATE'
    ]);
    assert.deepEqual(analyzed.nonDirectModifierTokens, [
        'MODIFIER_VALUE_FIRE_RATE'
    ]);
});


test('zero-valued provided-property rows remain in substrate but do not promote mechanic relevance', () => {
    assert.equal(isMeaningfulProvidedStat({ providedPropertyType: 'MODIFIER_VALUE_WEAPON_POWER', value: '0', numericValue: 0 }), false);
    assert.equal(isMeaningfulProvidedStat({ providedPropertyType: 'MODIFIER_VALUE_WEAPON_POWER', value: '0%', numericValue: null }), false);
    assert.equal(isMeaningfulProvidedStat({ providedPropertyType: 'MODIFIER_VALUE_WEAPON_POWER', value: '5', numericValue: 5 }), true);
    assert.equal(isMeaningfulProvidedStat({ providedPropertyType: 'MODIFIER_VALUE_FIRE_RATE', value: 'BaseFireRate * 0.15', numericValue: null }), true);
});
