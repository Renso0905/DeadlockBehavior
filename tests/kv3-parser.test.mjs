import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractKv3Root,
    parseTopLevelEntries,
    parseFlatScalarMap,
    extractNamedObjectField,
    extractNamedArrayField,
    extractObjectBodies
} from '../src/vdata/kv3-parser.mjs';

test('skips KV3 metadata header braces (Script132 V01 regression)', () => {
    const text = `<!-- kv3 encoding:text:version{deadbeef} format:generic:version{1234} -->\n{\n  foo = {\n    value = 42\n  }\n}`;
    const root = extractKv3Root(text);
    assert.ok(root);
    const entries = parseTopLevelEntries(root.inner);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, 'foo');
    assert.equal(parseFlatScalarMap(entries[0].inner).value, 42);
});

test('preserves nested permanent pickup script values (Script136 V01 regression)', () => {
    const text = `\n      m_sModifer = subclass: {\n        _class = "modifier_permanent_pickup"\n        m_vecScriptValues = [\n          {\n            m_eModifierValue = "MODIFIER_VALUE_FIRE_RATE"\n            m_value = 1.5\n          }\n        ]\n      }\n    `;
    const modifier = extractNamedObjectField(text, 'm_sModifer');
    assert.ok(modifier);
    const values = extractNamedArrayField(modifier.inner, 'm_vecScriptValues');
    assert.ok(values);
    const bodies = extractObjectBodies(values.inner);
    assert.equal(bodies.length, 1);
    assert.deepEqual(parseFlatScalarMap(bodies[0]), {
        m_eModifierValue: 'MODIFIER_VALUE_FIRE_RATE',
        m_value: 1.5
    });
});

test('preserves bridge modifier endpoint arrays', () => {
    const text = `\n      m_sModifer = subclass: {\n        _class = "modifier_citadel_powerup_gun"\n        m_flDuration = 160\n        m_vecModifierValues = [\n          {\n            m_eModifierValue = "MODIFIER_VALUE_FIRE_RATE"\n            m_valueMin = 12\n            m_valueMax = 35\n          },\n          {\n            m_eModifierValue = "MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT"\n            m_valueMin = 35\n            m_valueMax = 70\n          }\n        ]\n      }\n    `;
    const modifier = extractNamedObjectField(text, 'm_sModifer');
    const values = extractNamedArrayField(modifier.inner, 'm_vecModifierValues');
    const bodies = extractObjectBodies(values.inner);
    assert.equal(bodies.length, 2);
    assert.equal(parseFlatScalarMap(bodies[0]).m_valueMax, 35);
    assert.equal(parseFlatScalarMap(bodies[1]).m_valueMin, 35);
});

test('ignores braces and comment delimiters inside quoted strings', () => {
    const text = `<!-- kv3 -->\n{\n  thing = {\n    path = "value/{not-a-root}//still-string"\n    enabled = true\n  }\n}`;
    const root = extractKv3Root(text);
    const entry = parseTopLevelEntries(root.inner)[0];
    const flat = parseFlatScalarMap(entry.inner);
    assert.equal(flat.path, 'value/{not-a-root}//still-string');
    assert.equal(flat.enabled, true);
});
