import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStateEvent, emptyPlayerState } from '../src/player-state/runtime-state-timeline.mjs';
import { validateIntegratedPlayerStateArtifact } from '../src/player-state/integrated-state-validation.mjs';

function makeArtifact() {
  const item = {
    itemId: 101,
    mapped: true,
    recordKey: 'upgrade_test',
    effectInputRef: 'item-effect:upgrade_test',
  };
  const interval = {
    intervalId: 'rep-bridge-1',
    playerName: 'P1',
    buffType: 'gun_powerup_pickup',
    recordKey: 'gun_powerup_pickup',
    startTick: 100,
    nominalEndTick: 10340,
    stateEndTick: 300,
    terminationReason: 'DEATH_TERMINATION',
    terminationObserved: true,
  };
  const events = [
    {
      tick: 10,
      playerKey: 'P1',
      causes: ['IDENTITY_OR_HERO_STATE', 'STANDARD_SHOP_OWNERSHIP'],
      identity: { playerName: 'P1', steamId: '7656111', heroId: 7, team: 2 },
      itemAdds: [item],
      itemRemoves: [],
      activeBridgeBuffs: [],
    },
    {
      tick: 100,
      playerKey: 'P1',
      causes: ['BRIDGE_ACQUISITION', 'BRIDGE_RUNTIME_INTERVAL'],
      itemAdds: [],
      itemRemoves: [],
      activeBridgeBuffs: [interval],
    },
    {
      tick: 150,
      playerKey: 'P1',
      causes: ['PERMANENT_WORLD_BUFF_STATE'],
      itemAdds: [],
      itemRemoves: [],
      permanentBuffState: {
        FIRE_RATE: { totalValue: 1.5, inferredUnits: 1, rows: [] },
      },
      activeBridgeBuffs: [interval],
    },
    {
      tick: 250,
      playerKey: 'P1',
      causes: ['PERMANENT_WORLD_BUFF_STATE'],
      itemAdds: [],
      itemRemoves: [],
      permanentBuffState: {
        FIRE_RATE: { totalValue: 3, inferredUnits: 2, rows: [] },
      },
      activeBridgeBuffs: [interval],
    },
    {
      tick: 300,
      playerKey: 'P1',
      causes: ['DEATH_TERMINATION', 'BRIDGE_RUNTIME_INTERVAL'],
      itemAdds: [],
      itemRemoves: [],
      activeBridgeBuffs: [],
    },
  ];

  let state = emptyPlayerState('P1');
  for (const event of events) state = applyStateEvent(state, event);

  return {
    version: 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01',
    status: 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION',
    bridgeIntervals: [interval],
    resourceEffectInputs: {
      standardShopItems: [{ ref: 'item-effect:upgrade_test', recordKey: 'upgrade_test' }],
      heroProfiles: [{ ref: 'hero:7', heroId: 7 }],
    },
    players: [{
      playerKey: 'P1',
      identity: { playerName: 'P1', steamId: '7656111', heroId: 7, team: 2 },
      heroResourceProfileRef: 'hero:7',
      events,
      finalState: state,
    }],
  };
}

test('integrated artifact passes semantic invariants even when synthetic coverage is incomplete', () => {
  const result = validateIntegratedPlayerStateArtifact(makeArtifact());
  assert.equal(result.semanticValidation.pass, true);
  assert.equal(result.coverageDiagnostics.complete, false);
  assert.equal(result.metrics.bridgeIntervals, 1);
});

test('bridge projection mismatch is a semantic contradiction', () => {
  const artifact = makeArtifact();
  artifact.players[0].events[2].activeBridgeBuffs = [];
  const result = validateIntegratedPlayerStateArtifact(artifact);
  assert.equal(result.semanticValidation.pass, false);
  assert.equal(result.semanticValidation.checks.bridgeProjectionExactAtAllEvents.pass, false);
  assert.ok(result.semanticValidation.contradictions.some(row => row.code === 'BRIDGE_ACTIVE_PROJECTION_MISMATCH'));
});

test('permanent-buff decrease is a semantic contradiction', () => {
  const artifact = makeArtifact();
  artifact.players[0].events[3].permanentBuffState.FIRE_RATE.totalValue = 1;
  const result = validateIntegratedPlayerStateArtifact(artifact);
  assert.equal(result.semanticValidation.pass, false);
  assert.equal(result.semanticValidation.checks.permanentBuffStateMonotonic.pass, false);
  assert.ok(result.semanticValidation.contradictions.some(row => row.code === 'PERMANENT_STATE_DECREASED'));
});

test('saved final state must equal deterministic replay of the event stream', () => {
  const artifact = makeArtifact();
  artifact.players[0].finalState.observedRuntime.health = 999;
  const result = validateIntegratedPlayerStateArtifact(artifact);
  assert.equal(result.semanticValidation.pass, false);
  assert.equal(result.semanticValidation.checks.finalStateReconstructionExact.pass, false);
});

test('coverage gaps do not silently become semantic contradictions', () => {
  const artifact = makeArtifact();
  artifact.bridgeIntervals = [];
  for (const event of artifact.players[0].events) event.activeBridgeBuffs = [];
  artifact.players[0].events = artifact.players[0].events.filter(event => !event.causes.includes('BRIDGE_RUNTIME_INTERVAL'));
  let state = emptyPlayerState('P1');
  for (const event of artifact.players[0].events) state = applyStateEvent(state, event);
  artifact.players[0].finalState = state;

  const result = validateIntegratedPlayerStateArtifact(artifact);
  assert.equal(result.semanticValidation.pass, true);
  assert.equal(result.coverageDiagnostics.checks.bridgeLayerExercised.pass, false);
});
