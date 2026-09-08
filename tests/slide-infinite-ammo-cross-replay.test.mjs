import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
  evaluateCrossReplayReplication,
  summarizeReplayRows,
} from '../src/player-state/slide-infinite-ammo-cross-replay.mjs';

function makeRows({
  presentZero = 200,
  presentPositive = 1,
  absentPositive = 5000,
  absentZero = 5,
  absentNegative = 0,
  heroBase = 1,
}) {
  const rows = [];

  for (let i = 0; i < presentZero; i++) {
    rows.push({
      covered: true,
      carrierPresent: true,
      label: 'ZERO',
      heroId:
        heroBase + (i % 4),
    });
  }

  for (let i = 0; i < presentPositive; i++) {
    rows.push({
      covered: true,
      carrierPresent: true,
      label: 'POSITIVE',
      heroId:
        heroBase + (i % 4),
    });
  }

  for (let i = 0; i < absentPositive; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'POSITIVE',
      heroId:
        heroBase + (i % 4),
    });
  }

  for (let i = 0; i < absentZero; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'ZERO',
      heroId:
        heroBase + (i % 4),
    });
  }

  for (let i = 0; i < absentNegative; i++) {
    rows.push({
      covered: true,
      carrierPresent: false,
      label: 'NEGATIVE',
      heroId:
        heroBase + (i % 4),
    });
  }

  return rows;
}

test('strong powered replay passes frozen consequence gates', () => {
  const rows =
    makeRows({});

  const summary =
    summarizeReplayRows(
      rows,
    );

  assert.equal(
    summary.sufficientlyPowered,
    true,
  );

  assert.equal(
    summary.semanticPass,
    true,
  );

  assert.equal(
    summary.contradiction,
    false,
  );
});

test('underpowered replay is neutral rather than contradictory', () => {
  const rows =
    makeRows({
      presentZero: 20,
      presentPositive: 0,
      absentPositive: 4000,
      absentZero: 1,
    });

  const summary =
    summarizeReplayRows(
      rows,
    );

  assert.equal(
    summary.sufficientlyPowered,
    false,
  );

  assert.equal(
    summary.semanticPass,
    false,
  );

  assert.equal(
    summary.contradiction,
    false,
  );
});

test('powered replay with poor carrier consequence is contradictory', () => {
  const rows =
    makeRows({
      presentZero: 150,
      presentPositive: 50,
      absentPositive: 5000,
      absentZero: 5,
    });

  const summary =
    summarizeReplayRows(
      rows,
    );

  assert.equal(
    summary.sufficientlyPowered,
    true,
  );

  assert.equal(
    summary.semanticPass,
    false,
  );

  assert.equal(
    summary.contradiction,
    true,
  );
});

test('five strong independent replays produce cross-replay replication', () => {
  const replayResults =
    Array.from(
      { length: 5 },
      (_, index) => {
        const rows =
          makeRows({
            heroBase:
              1 + index * 4,
          });

        return {
          replayName:
            `rep0${index + 1}`,
          integrityPass:
            true,
          rows,
          summary:
            summarizeReplayRows(
              rows,
            ),
        };
      },
    );

  const result =
    evaluateCrossReplayReplication(
      replayResults,
    );

  assert.equal(
    result.allFiveUsable,
    true,
  );

  assert.equal(
    result.allFivePowered,
    true,
  );

  assert.equal(
    result.allFiveStrong,
    true,
  );

  assert.equal(
    result.noContradictions,
    true,
  );

  assert.ok(
    result.pooled.heroSupport
      .supportingHeroCount
      >= CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS
        .minDistinctSupportingHeroesAcrossCohort,
  );

  assert.equal(
    result.crossReplayReplicated,
    true,
  );
});

test('one sufficiently powered contradictory replay blocks replication', () => {
  const replayResults =
    Array.from(
      { length: 5 },
      (_, index) => {
        const rows =
          index === 3
            ? makeRows({
              presentZero: 100,
              presentPositive: 100,
              heroBase:
                1 + index * 4,
            })
            : makeRows({
              heroBase:
                1 + index * 4,
            });

        return {
          replayName:
            `rep0${index + 1}`,
          integrityPass:
            true,
          rows,
          summary:
            summarizeReplayRows(
              rows,
            ),
        };
      },
    );

  const result =
    evaluateCrossReplayReplication(
      replayResults,
    );

  assert.equal(
    result.contradictoryReplays.length,
    1,
  );

  assert.equal(
    result.crossReplayReplicated,
    false,
  );

  assert.equal(
    result.classification,
    'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_CONTRADICTED_IN_INDEPENDENT_REPLAY',
  );
});
