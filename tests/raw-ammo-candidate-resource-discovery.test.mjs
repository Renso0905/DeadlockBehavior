import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractBalancedRecordBlock,
  extractFieldAssignments,
  scanRawResourceCorpus,
} from '../src/vdata/raw-ammo-candidate-resource-discovery.mjs';

test('extracts exact balanced KV3-style record block', () => {
  const text = `
"upgrade_quick_silver"
{
  "AmmoReloadPercent" "50"
  "Nested"
  {
    "x" "1"
  }
}
"upgrade_other"
{
  "AmmoReloadPercent" "10"
}
`;

  const block =
    extractBalancedRecordBlock(
      text,
      'upgrade_quick_silver',
    );

  assert.ok(block);

  assert.match(
    block.text,
    /AmmoReloadPercent/,
  );

  assert.doesNotMatch(
    block.text,
    /upgrade_other/,
  );
});

test('quoted braces do not break balanced record extraction', () => {
  const text = `
"upgrade_test"
{
  "icon" "file://{images}/thing.psd"
  "AmmoReloadPercent" "25"
}
`;

  const block =
    extractBalancedRecordBlock(
      text,
      'upgrade_test',
    );

  assert.ok(block);

  assert.match(
    block.text,
    /AmmoReloadPercent/,
  );
});

test('parses equals assignment', () => {
  const rows =
    extractFieldAssignments(
      `
{
  AmmoReloadPercent = 0.5
}
`,
      ['AmmoReloadPercent'],
    );

  assert.equal(
    rows.length,
    1,
  );

  assert.equal(
    rows[0].assignmentRecognized,
    true,
  );

  assert.equal(
    rows[0].parsedNumericValue,
    0.5,
  );
});

test('parses quoted KV assignment', () => {
  const rows =
    extractFieldAssignments(
      `
{
  "BonusClipPerKill" "2"
}
`,
      ['BonusClipPerKill'],
    );

  assert.equal(
    rows.length,
    1,
  );

  assert.equal(
    rows[0].parsedNumericValue,
    2,
  );
});

test('field outside exact record block cannot be assigned to candidate', () => {
  const text = `
"upgrade_quick_silver"
{
  "FireRate" "10"
}
"upgrade_other"
{
  "AmmoReloadPercent" "50"
}
`;

  const block =
    extractBalancedRecordBlock(
      text,
      'upgrade_quick_silver',
    );

  const rows =
    extractFieldAssignments(
      block.text,
      ['AmmoReloadPercent'],
    );

  assert.equal(
    rows.length,
    0,
  );
});

test('raw corpus scanner helper is exported', () => {
  assert.equal(
    typeof scanRawResourceCorpus,
    'function',
  );
});
