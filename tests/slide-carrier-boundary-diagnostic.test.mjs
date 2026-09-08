import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inspectCarrierBoundary,
  stateAtTick,
  summarizeBoundaryTiming,
} from '../src/player-state/slide-carrier-boundary-diagnostic.mjs';

test('stateAtTick returns latest carrier state without future leakage', () => {
  const timeline = [
    {
      tick: 10,
      covered: true,
      present: true,
    },
    {
      tick: 20,
      covered: true,
      present: false,
    },
  ];

  assert.equal(
    stateAtTick(timeline, 15).present,
    true,
  );

  assert.equal(
    stateAtTick(timeline, 25).present,
    false,
  );
});

test('recent carrier exit is detected before absent attack', () => {
  const timeline = [
    {
      tick: 10,
      covered: true,
      present: true,
    },
    {
      tick: 20,
      covered: true,
      present: false,
    },
  ];

  const result =
    inspectCarrierBoundary(
      timeline,
      21,
      [1, 2],
    );

  assert.equal(
    result['1'].before,
    false,
  );

  assert.equal(
    result['2'].before,
    true,
  );
});

test('imminent carrier entry is detected after absent attack', () => {
  const timeline = [
    {
      tick: 10,
      covered: true,
      present: false,
    },
    {
      tick: 12,
      covered: true,
      present: true,
    },
  ];

  const result =
    inspectCarrierBoundary(
      timeline,
      11,
      [1],
    );

  assert.equal(
    result['1'].after,
    true,
  );
});

test('boundary-specific zeros produce strong diagnostic classification', () => {
  const timelineByPawn =
    new Map([
      [
        1,
        [
          {
            tick: 1,
            covered: true,
            present: true,
          },
          {
            tick: 10,
            covered: true,
            present: false,
          },
        ],
      ],
      [
        2,
        [
          {
            tick: 1,
            covered: true,
            present: false,
          },
        ],
      ],
    ]);

  const rows = [];

  for (let i = 0; i < 20; i++) {
    rows.push({
      pawnEntityIndex: 1,
      tick: 11,
      heroId: 58,
      combinedLabel: 'ZERO',
      primaryCovered: true,
      primaryPresent: false,
      tickGap: 5,
    });
  }

  for (let i = 0; i < 1000; i++) {
    rows.push({
      pawnEntityIndex: 2,
      tick: 100 + i,
      heroId: 1,
      combinedLabel: 'POSITIVE',
      primaryCovered: true,
      primaryPresent: false,
      tickGap: 5,
    });
  }

  const result =
    summarizeBoundaryTiming(
      rows,
      timelineByPawn,
      [1, 2, 4, 8],
    );

  assert.equal(
    result.classification,
    'SLIDE_CARRIER_BOUNDARY_PHASE_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS',
  );
});
