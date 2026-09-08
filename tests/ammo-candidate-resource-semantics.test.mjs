import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticAudit,
  collectSemanticScalars,
  summarizeCandidateSemantics,
} from '../src/player-state/ammo-candidate-resource-semantics.mjs';

test('diagnostic field-name-only evidence is not value-bearing', () => {
  const rows =
    collectSemanticScalars({
      weaponStateRelevant: {
        genericRecordFieldNamesDiagnosticOnly: [
          'AmmoReloadPercent',
        ],
      },
    });

  const row =
    rows.find(
      candidate =>
        candidate.value === 'AmmoReloadPercent',
    );

  assert.equal(
    row.diagnosticFieldNameOnly,
    true,
  );

  assert.equal(
    row.valueBearing,
    false,
  );
});

test('numeric ammo field is recognized as value-bearing', () => {
  const result =
    summarizeCandidateSemantics({
      candidate: {
        recordKey: 'upgrade_test',
        runtimeItemId: 123,
        resourceClassification:
          'CURRENT_AMMO_FIELD_CANDIDATE',
      },

      item: {
        recordKey: 'upgrade_test',
        rawAmmoConfig: {
          AmmoReloadPercent: 0.5,
        },
      },
    });

  assert.equal(
    result.evidenceDepth,
    'NUMERIC_AMMO_VALUE_PRESENT',
  );

  assert.equal(
    result.counts.numericAmmoValues,
    1,
  );
});

test('candidate missing from Script139 remains explicit integrity evidence', () => {
  const result =
    buildSemanticAudit({
      candidates: [
        {
          recordKey: 'upgrade_missing',
          runtimeItemId: 1,
          resourceClassification:
            'CURRENT_AMMO_FIELD_CANDIDATE',
        },
      ],
      effects: {
        items: [],
      },
    });

  assert.equal(
    result.missingItemCount,
    1,
  );
});

test('complete synthetic candidate set is audited independently of replay exposure', () => {
  const result =
    buildSemanticAudit({
      candidates: [
        {
          recordKey: 'upgrade_a',
          runtimeItemId: 1,
          resourceClassification:
            'CURRENT_AMMO_FIELD_CANDIDATE',
        },
        {
          recordKey: 'upgrade_b',
          runtimeItemId: 2,
          resourceClassification:
            'AMMO_RESOURCE_EVIDENCE_UNRESOLVED',
        },
      ],

      effects: {
        items: [
          {
            recordKey: 'upgrade_a',
            weaponStateRelevant: {
              genericRecordFieldNamesDiagnosticOnly: [
                'AmmoReloadPercent',
              ],
            },
          },
          {
            recordKey: 'upgrade_b',
            selectedTopLevelMetadata: {
              m_strCSSClass:
                'activeReload',
            },
          },
        ],
      },
    });

  assert.equal(
    result.candidateCount,
    2,
  );

  assert.equal(
    result.missingItemCount,
    0,
  );
});
