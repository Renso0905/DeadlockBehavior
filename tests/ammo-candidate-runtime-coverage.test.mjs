import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateUniverse,
  summarizeRuntimeCoverage,
  murmurHash2,
} from '../src/player-state/ammo-candidate-runtime-coverage.mjs';

test('Deadlock item hash fixture remains frozen', () => {
  assert.equal(
    murmurHash2('upgrade_magic_reach'),
    754480263,
  );
});

test('candidate universe hashes all Script202 candidates', () => {
  const rows =
    buildCandidateUniverse({
      census: {
        currentAmmoCandidates: [
          {
            recordKey: 'upgrade_quick_silver',
            classification: 'CURRENT_AMMO_FIELD_CANDIDATE',
          },
        ],
      },
    });

  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].recordKey,
    'upgrade_quick_silver',
  );
  assert.ok(
    Number.isFinite(rows[0].runtimeItemId),
  );
});

test('coverage keeps unobserved item explicitly open', () => {
  const candidate = {
    recordKey: 'upgrade_unseen',
    runtimeItemId: 123,
    resourceClassification:
      'CURRENT_AMMO_FIELD_CANDIDATE',
  };

  const result =
    summarizeRuntimeCoverage({
      candidates: [candidate],
      contextIndex: new Map(),
      runtimeRows: [],
      restorationEvents: [],
    });

  assert.equal(
    result.rows[0].disposition,
    'NOT_OBSERVED_IN_TEST',
  );
});

test('attack exposure without restoration is negative exposure only, not falsification', () => {
  const candidate = {
    recordKey: 'upgrade_seen',
    runtimeItemId: 123,
    resourceClassification:
      'CURRENT_AMMO_FIELD_CANDIDATE',
  };

  const contextIndex =
    new Map([
      [
        'weapon-context-1',
        {
          effectContextId: 'weapon-context-1',
          heroId: 4,
          itemIds: [123],
        },
      ],
    ]);

  const result =
    summarizeRuntimeCoverage({
      candidates: [candidate],
      contextIndex,
      runtimeRows: [
        {
          heroId: 4,
          effectContextId: 'weapon-context-1',
          changedFields: ['m_nShotNumber'],
        },
      ],
      restorationEvents: [],
    });

  assert.equal(
    result.rows[0].attackExposure,
    1,
  );

  assert.equal(
    result.rows[0].disposition,
    'OBSERVED_NEGATIVE_EXPOSURE_ONLY',
  );
});

test('candidate present in restoration context is surfaced', () => {
  const candidate = {
    recordKey: 'upgrade_restore',
    runtimeItemId: 123,
    resourceClassification:
      'CURRENT_AMMO_FIELD_CANDIDATE',
  };

  const contextIndex =
    new Map([
      [
        'weapon-context-1',
        {
          effectContextId: 'weapon-context-1',
          heroId: 4,
          itemIds: [123],
        },
      ],
    ]);

  const result =
    summarizeRuntimeCoverage({
      candidates: [candidate],
      contextIndex,
      runtimeRows: [
        {
          heroId: 4,
          effectContextId: 'weapon-context-1',
          changedFields: ['m_nShotNumber'],
        },
      ],
      restorationEvents: [
        {
          heroId: 4,
          tick: 100,
          effectContextId: 'weapon-context-1',
          logicalGain: 2,
          grossRestorationIfOneShotConsumed: 3,
        },
      ],
    });

  assert.equal(
    result.rows[0].disposition,
    'OBSERVED_WITH_RESTORATION',
  );

  assert.equal(
    result.rows[0].restorationEventCount,
    1,
  );

  assert.equal(
    result.eventMatrix[0].candidateCount,
    1,
  );
});
