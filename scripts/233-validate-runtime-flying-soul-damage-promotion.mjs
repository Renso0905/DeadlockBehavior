import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { publishedDirectory } from '../inspector-v04/lib/run-integrity.mjs';

const TICK_RATE = 64;
const requested = process.argv.slice(2).filter(value => !value.startsWith('--'));
const names = requested.length
  ? requested
  : (await fs.readdir('replays')).filter(value => value.toLowerCase().endsWith('.dem')).map(value => value.slice(0, -4)).sort();
const results = [];

for (const replayName of names) {
  const replayDir = resolve('output', replayName);
  const manifest = await readJson(join(replayDir, 'production_manifest_v01.json'));
  const productionDir = publishedDirectory(replayDir, manifest);
  const artifact = await readJson(join(productionDir, 'runtime_flying_soul_production_v01.json'));
  const events = await readJsonl(join(productionDir, 'runtime_flying_soul_events_v01.jsonl'));
  const errors = [];
  const check = (pass, message) => { if (!pass) errors.push(message); };
  const observedKeys = new Set();
  const byPlayer = new Map();
  let episodesWithDamage = 0;
  let totalMessages = 0;
  let multiMessageEpisodes = 0;
  let multiPlayerEpisodes = 0;
  let mixedTeamEpisodes = 0;

  check(manifest?.runStatus === 'COMPLETE', 'published manifest is not COMPLETE');
  check(manifest?.coverage?.completeAuthoritative === 124, `manifest A coverage is ${manifest?.coverage?.completeAuthoritative ?? 'missing'}, expected 124`);
  check(artifact?.status === 'RUNTIME_FLYING_SOUL_PRODUCTION_V01_READY', 'flying-soul artifact is not READY');
  check(artifact?.validation?.pass === true, 'artifact validation did not pass');
  check(artifact?.damageDiagnostics?.ambiguousEpisodeMatches === 0, 'ambiguous damage-to-episode matches were published');
  check(artifact?.damageDiagnostics?.unresolvedAttacker === 0, 'damage messages with unresolved sampled-player attackers were published');

  for (const event of events) {
    const attackableStartTick = reconstructedTick(event, event.attackableTime);
    const attackableEndTick = reconstructedTick(event, event.endAttackableTime);
    check(Number.isInteger(attackableStartTick) && Number.isInteger(attackableEndTick) && attackableEndTick >= attackableStartTick, `invalid direct attackable window at ${event.episodeId}`);
    const messages = event.playerDamageMessages ?? [];
    const players = new Set();
    const teams = new Set();
    if (messages.length) episodesWithDamage++;
    if (messages.length > 1) multiMessageEpisodes++;
    totalMessages += messages.length;
    for (const message of messages) {
      const player = message.attackerPlayer ?? {};
      check(Number(message.victimIndex) === Number(event.entityIndex), `victim mismatch at ${event.episodeId}:${message.tick}`);
      check(Number(message.tick) >= attackableStartTick && Number(message.tick) <= attackableEndTick, `message outside direct attackable window at ${event.episodeId}:${message.tick}`);
      check(message.messageType === 'k_EUserMsg_Damage', `unexpected message type at ${event.episodeId}:${message.tick}`);
      check(Number(message.attackerIndex) === Number(player.pawnEntityIndex), `attacker pawn mismatch at ${event.episodeId}:${message.tick}`);
      check(typeof player.playerId === 'string' && Number.isInteger(Number(player.controllerEntityIndex)) && [2, 3].includes(Number(player.team)), `incomplete sampled-player identity at ${event.episodeId}:${message.tick}`);
      players.add(player.playerId);
      teams.add(Number(player.team));
      const key = `${message.tick}|${message.victimIndex}|${message.attackerIndex}`;
      observedKeys.add(key);
      if (!byPlayer.has(player.playerId)) byPlayer.set(player.playerId, { controllerEntityIndex: Number(player.controllerEntityIndex), damagedEpisodes: new Set(), damageMessages: 0 });
      const row = byPlayer.get(player.playerId);
      row.damagedEpisodes.add(event.episodeId);
      row.damageMessages++;
    }
    if (players.size > 1) multiPlayerEpisodes++;
    if (teams.size > 1) mixedTeamEpisodes++;
    check(Boolean(event.damageObservation?.observedPlayerDamage) === (messages.length > 0), `observed-damage flag mismatch at ${event.episodeId}`);
    check(Number(event.damageObservation?.damageMessageCount) === messages.length, `damage-message count mismatch at ${event.episodeId}`);
    check(Number(event.damageObservation?.distinctPlayerCount) === players.size, `distinct-player count mismatch at ${event.episodeId}`);
    check(Number(event.damageObservation?.distinctTeamCount) === teams.size, `distinct-team count mismatch at ${event.episodeId}`);
  }

  const summary = artifact?.summary?.damageObservation ?? {};
  check(Number(artifact?.summary?.episodes) === events.length, 'event rows do not reconcile with episode summary');
  check(Number(summary.episodesWithObservedPlayerDamage) === episodesWithDamage, 'observed-damage episode count does not reconcile');
  check(Number(summary.episodesWithoutObservedPlayerDamage) === events.length - episodesWithDamage, 'no-observed-damage episode count does not reconcile');
  check(Number(summary.totalObservedPlayerDamageMessages) === totalMessages, 'damage-message total does not reconcile');
  check(Number(summary.multiMessageEpisodes) === multiMessageEpisodes, 'multi-message episode count does not reconcile');
  check(Number(summary.multiPlayerEpisodes) === multiPlayerEpisodes, 'multi-player episode count does not reconcile');
  check(Number(summary.mixedTeamEpisodes) === mixedTeamEpisodes, 'mixed-team episode count does not reconcile');
  for (const expected of summary.byPlayer ?? []) {
    const actual = byPlayer.get(expected.playerId);
    check(Boolean(actual), `summary player ${expected.playerId} has no observed messages`);
    if (actual) {
      check(actual.controllerEntityIndex === Number(expected.controllerEntityIndex), `controller identity mismatch for ${expected.playerId}`);
      check(actual.damagedEpisodes.size === Number(expected.damagedEpisodes), `damaged-episode count mismatch for ${expected.playerId}`);
      check(actual.damageMessages === Number(expected.damageMessages), `damage-message count mismatch for ${expected.playerId}`);
    }
  }

  const researchPath = join(replayDir, 'flying_soul_temporal_hits_v02.jsonl');
  let establishedInsideWindowHits = null;
  let establishedHitsReproduced = null;
  if (await exists(researchPath)) {
    const researchRows = (await readJsonl(researchPath)).filter(row => row.insideAttackableWindow === true);
    establishedInsideWindowHits = researchRows.length;
    establishedHitsReproduced = researchRows.filter(row => observedKeys.has(`${row.tick}|${row.victimEntityIndex}|${row.attackerEntityIndex}`)).length;
    check(establishedHitsReproduced === establishedInsideWindowHits, `reproduced ${establishedHitsReproduced}/${establishedInsideWindowHits} established direct-window hits`);
  }

  const result = {
    replayName,
    runId: manifest?.runId ?? null,
    episodes: events.length,
    episodesWithObservedPlayerDamage: episodesWithDamage,
    episodesWithoutObservedPlayerDamage: events.length - episodesWithDamage,
    damageMessages: totalMessages,
    multiMessageEpisodes,
    multiPlayerEpisodes,
    mixedTeamEpisodes,
    establishedInsideWindowHits,
    establishedHitsReproduced,
    pass: errors.length === 0,
    errors
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

const totals = {
  replays: results.length,
  replaysWithObservedPlayerDamage: results.filter(result => result.damageMessages > 0).length,
  episodes: sum('episodes'),
  episodesWithObservedPlayerDamage: sum('episodesWithObservedPlayerDamage'),
  episodesWithoutObservedPlayerDamage: sum('episodesWithoutObservedPlayerDamage'),
  damageMessages: sum('damageMessages'),
  multiMessageEpisodes: sum('multiMessageEpisodes'),
  multiPlayerEpisodes: sum('multiPlayerEpisodes'),
  mixedTeamEpisodes: sum('mixedTeamEpisodes'),
  researchComparisons: results.filter(result => result.establishedInsideWindowHits !== null).length,
  establishedInsideWindowHits: results.reduce((total, result) => total + Number(result.establishedInsideWindowHits ?? 0), 0),
  establishedHitsReproduced: results.reduce((total, result) => total + Number(result.establishedHitsReproduced ?? 0), 0)
};
const pass = results.length >= 6
  && results.every(result => result.pass)
  && totals.replaysWithObservedPlayerDamage >= 6
  && totals.researchComparisons >= 5
  && totals.establishedHitsReproduced === totals.establishedInsideWindowHits;
const report = {
  version: 'RUNTIME_FLYING_SOUL_DAMAGE_PROMOTION_VALIDATION_V01',
  generatedAt: new Date().toISOString(),
  status: pass ? 'READY_FOR_SCOPED_A_AUTHORITY' : 'FAILED',
  semanticScope: {
    supported: [
      'Direct k_EUserMsg_Damage observations whose victim is an accepted source-linked flying-soul entity and whose tick falls inside its reconstructed direct attackable window',
      'Unique sampled player pawn, controller, and team attribution for each accepted damage message',
      'Per-episode message, distinct-player, and distinct-team counts plus per-player observed message and episode counts'
    ],
    excluded: [
      'Shot attempts, misses, ignored opportunities, accuracy, or projectile causality',
      'Secure or deny result, winner, reward recipient or value, or automatic award',
      'Continuous visibility, line of sight, aim feasibility, or player opportunity'
    ]
  },
  replays: results,
  totals,
  pass
};
await fs.mkdir('output/cross_replay', { recursive: true });
await fs.writeFile('output/cross_replay/runtime_flying_soul_damage_promotion_validation_v01.json', `${JSON.stringify(report, null, 2)}\n`);
if (!pass) process.exitCode = 1;

function reconstructedTick(event, value) {
  const startTick = finite(event?.startTick);
  const timeLaunch = finite(event?.timeLaunch);
  const time = finite(value);
  return startTick === null || timeLaunch === null || time === null ? null : Math.round(startTick + (time - timeLaunch) * TICK_RATE);
}
function finite(value) { const number = Number(value); return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number; }
function sum(key) { return results.reduce((total, result) => total + Number(result[key] ?? 0), 0); }
async function exists(path) { try { await fs.access(path); return true; } catch { return false; } }
async function readJson(path) { return JSON.parse(await fs.readFile(path, 'utf8')); }
async function readJsonl(path) {
  const rows = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}
