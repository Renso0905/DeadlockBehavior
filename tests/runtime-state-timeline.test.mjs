import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeBridgeIntervalsAt,
  applyStateEvent,
  buildBridgeIntervals,
  buildPlayerTimeline,
  emptyPlayerState,
  stateAtTick,
} from '../src/player-state/runtime-state-timeline.mjs';

test('bridge interval naturally expires after 160 seconds at 64 Hz', () => {
  const [row] = buildBridgeIntervals({
    collections: [{ tick: 1000, playerName: 'P1', recordKey: 'gun_powerup_pickup' }],
    replayEndTick: 50000,
  });
  assert.equal(row.nominalEndTick, 11240);
  assert.equal(row.stateEndTick, 11240);
  assert.equal(row.terminationReason, 'NATURAL_EXPIRATION');
  assert.equal(activeBridgeIntervalsAt([row], 'P1', 11239).length, 1);
  assert.equal(activeBridgeIntervalsAt([row], 'P1', 11240).length, 0);
});

test('death terminates bridge interval before natural expiry', () => {
  const [row] = buildBridgeIntervals({
    collections: [{ tick: 1000, playerName: 'P1', recordKey: 'survival_powerup_pickup' }],
    deaths: [{ tick: 5000, playerName: 'P1' }],
    replayEndTick: 50000,
  });
  assert.equal(row.stateEndTick, 5000);
  assert.equal(row.terminationReason, 'DEATH_TERMINATION');
  assert.equal(row.terminationObserved, true);
});

test('postgame before nominal expiry is censoring rather than natural expiration', () => {
  const [row] = buildBridgeIntervals({
    collections: [{ tick: 1000, playerName: 'P1', recordKey: 'survival_powerup_pickup' }],
    postGameTick: 9000,
    replayEndTick: 12000,
  });
  assert.equal(row.stateEndTick, 9000);
  assert.equal(row.terminationReason, 'MATCH_END_CENSORED');
  assert.equal(row.terminationObserved, false);
});

test('event-sourced state applies observed, item, permanent, and bridge layers independently', () => {
  const initial = emptyPlayerState('P1');
  const state = applyStateEvent(initial, {
    tick: 100,
    identity: { playerName: 'P1', heroId: 7 },
    observedRuntime: { level: 4, health: 900 },
    itemAdds: [{ itemId: 1, recordKey: 'upgrade_a' }],
    permanentBuffState: { healthMax: { totalValue: 15, inferredUnits: 1 } },
    activeBridgeBuffs: [{ recordKey: 'survival_powerup_pickup', startTick: 90, stateEndTick: 1000 }],
  });
  assert.equal(state.observedRuntime.health, 900);
  assert.equal(state.authoritativeOwnership.standardShopItems[0].recordKey, 'upgrade_a');
  assert.equal(state.authoritativeOwnership.permanentWorldBuffs.healthMax.totalValue, 15);
  assert.equal(state.authoritativeOwnership.activeBridgeBuffs.length, 1);
});

test('stateAtTick returns latest event-sourced snapshot without future leakage', () => {
  const timeline = buildPlayerTimeline({
    events: [
      { tick: 10, playerKey: 'P1', observedRuntime: { level: 1 }, causes: ['RAW'] },
      { tick: 20, playerKey: 'P1', observedRuntime: { level: 2 }, causes: ['RAW'] },
    ],
  });
  assert.equal(stateAtTick(timeline, 9), null);
  assert.equal(stateAtTick(timeline, 10).observedRuntime.level, 1);
  assert.equal(stateAtTick(timeline, 19).observedRuntime.level, 1);
  assert.equal(stateAtTick(timeline, 20).observedRuntime.level, 2);
});
