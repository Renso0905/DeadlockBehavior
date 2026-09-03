import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const replayName = process.argv[2] ?? 'test';
const TICK_RATE = 64;

const shotSummaryPath = resolve('output', replayName, 'citemxp_shot_outcome_validation_v01.json');
const shotOutcomePath = resolve('output', replayName, 'citemxp_shot_outcomes_v01.jsonl');
const summaryPath = resolve('output', replayName, 'citemxp_race_resolution_validation_v01.json');
const correctedOutcomePath = resolve('output', replayName, 'citemxp_corrected_shot_outcomes_v01.jsonl');

for (const path of [shotSummaryPath, shotOutcomePath]) {
  if (!existsSync(path)) throw new Error(`Missing required input:\n${path}`);
}

const shotSummary = JSON.parse(readFileSync(shotSummaryPath, 'utf8'));
if (shotSummary?.validation?.pass !== true) throw new Error('Script 61 shot-outcome validation did not PASS.');

console.log('\nLoading Script 61 per-orb outcomes...');
const rows = (await loadJsonl(shotOutcomePath)).map(normalizeRow).filter(Boolean);
const trooperRows = rows.filter(r => r.sourceType === 'TROOPER_DEATH');
const urnRows = rows.filter(r => r.sourceType === 'URN_DELIVERY');
const shotRows = rows.filter(r => r.playerDamageEvents.length > 0);
const noShotRows = rows.filter(r => r.playerDamageEvents.length === 0);

for (const row of rows) row.analysis = analyzeRow(row);

const multiMessageRows = shotRows.filter(r => r.playerDamageEvents.length > 1);
const multiPlayerRows = shotRows.filter(r => r.analysis.distinctPlayers > 1);
const mixedTeamRows = shotRows.filter(r => r.analysis.distinctTeams > 1);
const singleTeamShotRows = shotRows.filter(r => r.analysis.distinctTeams === 1);
const shotEndRows = shotRows.filter(r => r.analysis.firstEndEventAfterFirstHit);
const noShotEndRows = noShotRows.filter(r => r.analysis.firstEndEventAfterAttackableEnd);

const multiMessageSpanSeconds = summarizeNumbers(multiMessageRows.map(r => (r.analysis.lastHit.tick - r.analysis.firstHit.tick) / TICK_RATE));
const mixedTeamSpanSeconds = summarizeNumbers(mixedTeamRows.map(r => (r.analysis.lastHit.tick - r.analysis.firstHit.tick) / TICK_RATE));
const firstHitToEndSeconds = summarizeNumbers(shotEndRows.map(r => (r.analysis.firstEndEventAfterFirstHit.tick - r.analysis.firstHit.tick) / TICK_RATE));
const noShotEndLatencySeconds = summarizeNumbers(noShotEndRows.map(r => (r.analysis.firstEndEventAfterAttackableEnd.tick - r.episode.attackableEndTick) / TICK_RATE));

const lifecycleOperationCounts = countBy(rows.flatMap(r => r.lifecycleEvents), e => e.operation ?? 'UNKNOWN');
const lifecycleChangedFieldCounts = countBy(rows.flatMap(r => r.lifecycleEvents.flatMap(e => e.changedFields ?? [])), f => f);
const correctedOutcomeCounts = countBy(rows, r => r.analysis.correctedOutcome.label);
const trooperCorrectedOutcomeCounts = countBy(trooperRows, r => r.analysis.correctedOutcome.label);
const urnCorrectedOutcomeCounts = countBy(urnRows, r => r.analysis.correctedOutcome.label);

const validation = {
  script61Passed: check(shotSummary?.validation?.pass, true, shotSummary?.validation?.pass === true),
  targetCountPreserved: check(rows.length, shotSummary?.targets?.total, rows.length === shotSummary?.targets?.total),
  trooperCountPreserved: check(trooperRows.length, shotSummary?.targets?.trooper, trooperRows.length === shotSummary?.targets?.trooper),
  urnCountPreserved: check(urnRows.length, shotSummary?.targets?.urn, urnRows.length === shotSummary?.targets?.urn),
  shotEpisodeCountPreserved: check(shotRows.length, shotSummary?.shotTiming?.shotEpisodes, shotRows.length === shotSummary?.shotTiming?.shotEpisodes),
  playerHitTelemetryValidated: check(shotSummary?.playerAttribution?.playerAttributionRate, 1, shotSummary?.playerAttribution?.playerAttributionRate === 1)
};
const validationPass = Object.values(validation).every(v => v.pass);

let firstHitInterpretation = 'FIRST_HIT_OUTCOME_REQUIRES_FURTHER_LIFECYCLE_VALIDATION';
if (mixedTeamRows.length === 0 && shotRows.length > 0) {
  firstHitInterpretation = 'NO_MIXED_TEAM_RACES_OBSERVED_FIRST_HIT_IS_STRONGLY_SUPPORTED';
} else if (mixedTeamRows.length > 0 && Number.isFinite(mixedTeamSpanSeconds.p90) && mixedTeamSpanSeconds.p90 <= 0.125) {
  firstHitInterpretation = 'MIXED_TEAM_RACES_EXIST_BUT_ARE_TIGHTLY_CLUSTERED_FIRST_HIT_IS_PLAUSIBLE_NOT_YET_CANONICAL';
}

mkdirSync(dirname(summaryPath), { recursive: true });
const writer = createWriteStream(correctedOutcomePath, { encoding: 'utf8' });
for (const row of rows) {
  writer.write(JSON.stringify({
    schemaVersion: 1,
    canonical: false,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    episode: row.episode,
    source: row.source,
    urnBurst: row.urnBurst,
    raceAnalysis: row.analysis.raceAnalysis,
    lifecycleAnalysis: row.analysis.lifecycleAnalysis,
    correctedOutcome: row.analysis.correctedOutcome
  }) + '\n');
}
await finishWriter(writer);

const summary = {
  replay: replayName,
  version: 'CITEMXP_RACE_RESOLUTION_VALIDATION_V01',
  canonical: false,
  status: validationPass ? 'RACE_AND_SEMANTICS_REVIEW_COMPLETE' : 'DIAGNOSTIC_ONLY',
  correctionToScript61: {
    urnSemantics: {
      issue: 'Script 61 reversed Soul Urn claim/deny semantics.',
      correctedRule: 'For validated Urn payout orbs, SAME_ORB_TEAM => CLAIM and OPPOSING_ORB_TEAM => DENY.'
    },
    firstHitSemantics: {
      issue: 'Script 61 used first player damage as the final outcome without quantifying multi-hit and mixed-team races.',
      correctedRule: 'Single-team shot episodes receive a high-confidence side outcome. Mixed-team episodes remain FIRST_HIT_PROVISIONAL until resolution timing confirms the winner.'
    }
  },
  counts: {
    targets: rows.length,
    trooperTargets: trooperRows.length,
    urnTargets: urnRows.length,
    shotEpisodes: shotRows.length,
    noShotEpisodes: noShotRows.length,
    multiMessageEpisodes: multiMessageRows.length,
    multiPlayerEpisodes: multiPlayerRows.length,
    mixedTeamEpisodes: mixedTeamRows.length,
    singleTeamShotEpisodes: singleTeamShotRows.length
  },
  raceDiagnostics: {
    playerDamageMessagesPerShotEpisode: summarizeNumbers(shotRows.map(r => r.playerDamageEvents.length)),
    multiMessageHitSpanSeconds: multiMessageSpanSeconds,
    mixedTeamHitSpanSeconds: mixedTeamSpanSeconds,
    mixedTeamRateAmongShotEpisodes: rate(mixedTeamRows.length, shotRows.length),
    firstHitInterpretation,
    mixedTeamExamples: mixedTeamRows.slice(0, 50).map(compactRaceExample),
    multipleHitExamples: multiMessageRows.slice(0, 50).map(compactRaceExample)
  },
  lifecycleDiagnostics: {
    operationCounts: mapToSortedObject(lifecycleOperationCounts),
    changedFieldCounts: mapToSortedObject(lifecycleChangedFieldCounts),
    shotEpisodesWithEndEventAfterFirstHit: shotEndRows.length,
    shotEndEventCoverage: rate(shotEndRows.length, shotRows.length),
    firstHitToEndSeconds,
    noShotEpisodesWithEndEventAfterAttackableEnd: noShotEndRows.length,
    noShotEndEventCoverage: rate(noShotEndRows.length, noShotRows.length),
    attackableEndToLifecycleEndSeconds: noShotEndLatencySeconds,
    caution: 'DELETE/LEAVE can reflect PVS or pooling. Treat lifecycle endings as diagnostic, not direct reward proof.'
  },
  correctedOutcomes: {
    all: mapToSortedObject(correctedOutcomeCounts),
    trooper: mapToSortedObject(trooperCorrectedOutcomeCounts),
    urn: mapToSortedObject(urnCorrectedOutcomeCounts),
    byPlayer: buildPlayerOutcomeSummary(rows),
    byUrnBurst: buildUrnBurstOutcomeSummary(urnRows)
  },
  validation: { pass: validationPass, checks: validation },
  interpretation: validationPass
    ? 'Script 61 hit telemetry is retained. Urn semantics are corrected. Single-team hit episodes can be interpreted directly; mixed-team races remain provisional.'
    : 'Input preservation failed; do not use corrected outcomes.',
  nextStep: 'If mixed-team hit spans and lifecycle endings support first-hit resolution, promote first-hit for shot outcomes. Then validate NO_SHOT episodes against direct award/net-worth telemetry before labeling AUTO_AWARD.',
  outputs: { summary: summaryPath, correctedOutcomes: correctedOutcomePath }
};
writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

console.log('\n=========================================');
console.log('CITEMXP RACE / RESOLUTION VALIDATION');
console.log('=========================================');
console.log(`\nTargets: ${rows.length}`);
console.log(`Shot episodes: ${shotRows.length}`);
console.log(`Multi-message episodes: ${multiMessageRows.length}`);
console.log(`Multi-player episodes: ${multiPlayerRows.length}`);
console.log(`Mixed-team episodes: ${mixedTeamRows.length}`);
console.log(`Mixed-team rate: ${formatPercent(rate(mixedTeamRows.length, shotRows.length))}`);
console.log(`Mixed-team span median: ${formatNumber(mixedTeamSpanSeconds.median)} sec`);
console.log(`Mixed-team span p90: ${formatNumber(mixedTeamSpanSeconds.p90)} sec`);
console.log(`Shot lifecycle-end coverage: ${formatPercent(rate(shotEndRows.length, shotRows.length))}`);
console.log(`First-hit -> lifecycle-end median: ${formatNumber(firstHitToEndSeconds.median)} sec`);
console.log(`No-shot lifecycle-end coverage: ${formatPercent(rate(noShotEndRows.length, noShotRows.length))}`);
console.log(`\nInterpretation: ${firstHitInterpretation}`);
console.log('\nCORRECTED OUTCOMES');
for (const [key, value] of Object.entries(mapToSortedObject(correctedOutcomeCounts))) console.log(`${key.padEnd(38)} ${value}`);
console.log('\nVALIDATION');
for (const [key, row] of Object.entries(validation)) console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${key.padEnd(36)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
console.log(`\nOVERALL: ${validationPass ? 'PASS' : 'FAIL'}`);
console.log(`\nSummary:\n${summaryPath}`);
console.log(`\nCorrected outcomes:\n${correctedOutcomePath}\n`);

function normalizeRow(row) {
  const e = row?.episode;
  if (!e || !['TROOPER_DEATH', 'URN_DELIVERY'].includes(row?.sourceType)) return null;
  const entityIndex = finite(e.entityIndex);
  const startTick = finite(e.startTick);
  const attackableStartTick = finite(e.attackableStartTick);
  const attackableEndTick = finite(e.attackableEndTick);
  if ([entityIndex, startTick, attackableStartTick, attackableEndTick].some(v => v === null)) return null;

  const playerDamageEvents = (Array.isArray(row?.allDamageEvents) ? row.allDamageEvents : [])
    .filter(ev => ev?.attackerPlayer)
    .map(normalizeDamageEvent)
    .filter(Boolean)
    .sort((a, b) => a.tick - b.tick);

  const lifecycleEvents = (Array.isArray(row?.lifecycleEvents) ? row.lifecycleEvents : [])
    .map(normalizeLifecycleEvent)
    .filter(Boolean)
    .sort((a, b) => a.tick - b.tick);

  return {
    sourceType: row.sourceType,
    sourceId: row?.sourceId ?? null,
    episode: { ...e, entityIndex, orbTeam: finite(e.orbTeam), startTick, attackableStartTick, attackableEndTick },
    source: row?.source ?? null,
    urnBurst: row?.urnBurst ?? null,
    playerDamageEvents,
    lifecycleEvents
  };
}

function normalizeDamageEvent(ev) {
  const tick = finite(ev?.tick);
  if (tick === null || !ev?.attackerPlayer) return null;
  return {
    tick,
    type: ev?.type ?? null,
    attackerIndex: finite(ev?.attackerIndex),
    attackerPlayer: {
      playerName: ev?.attackerPlayer?.playerName ?? 'UNKNOWN',
      team: finite(ev?.attackerPlayer?.team),
      heroId: finite(ev?.attackerPlayer?.heroId),
      pawnEntityIndex: finite(ev?.attackerPlayer?.pawnEntityIndex)
    },
    insideExactAttackableWindow: ev?.insideExactAttackableWindow === true,
    insideTolerantAttackableWindow: ev?.insideTolerantAttackableWindow === true,
    ticksAfterAttackableStart: finite(ev?.ticksAfterAttackableStart)
  };
}

function normalizeLifecycleEvent(ev) {
  const tick = finite(ev?.tick);
  if (tick === null) return null;
  return {
    tick,
    operation: String(ev?.operation ?? 'UNKNOWN'),
    changedFields: Array.isArray(ev?.changedFields) ? ev.changedFields.map(String) : [],
    team: finite(ev?.team),
    ownerEntity: ev?.ownerEntity ?? null,
    launchNum: finite(ev?.launchNum),
    subclassId: ev?.subclassId != null ? String(ev.subclassId) : null
  };
}

function analyzeRow(row) {
  const hits = row.playerDamageEvents;
  const firstHit = hits[0] ?? null;
  const lastHit = hits.at(-1) ?? null;
  const players = new Set(hits.map(h => h.attackerPlayer.playerName));
  const teams = new Set(hits.map(h => h.attackerPlayer.team).filter(isGameTeam));
  const firstRelation = firstHit ? relationToOrbTeam(firstHit.attackerPlayer.team, row.episode.orbTeam) : null;
  const lastRelation = lastHit ? relationToOrbTeam(lastHit.attackerPlayer.team, row.episode.orbTeam) : null;
  const endEvents = row.lifecycleEvents.filter(e => ['DELETE', 'LEAVE'].includes(e.operation));
  const firstEndEventAfterFirstHit = firstHit ? endEvents.find(e => e.tick >= firstHit.tick) ?? null : null;
  const firstEndEventAfterAttackableEnd = endEvents.find(e => e.tick >= row.episode.attackableEndTick) ?? null;
  const correctedOutcome = buildCorrectedOutcome(row, firstHit, firstRelation, teams.size);

  return {
    distinctPlayers: players.size,
    distinctTeams: teams.size,
    firstHit,
    lastHit,
    firstEndEventAfterFirstHit,
    firstEndEventAfterAttackableEnd,
    raceAnalysis: {
      damageMessageCount: hits.length,
      distinctPlayers: players.size,
      distinctTeams: teams.size,
      mixedTeamRace: teams.size > 1,
      firstHit,
      lastHit,
      firstRelationToOrbTeam: firstRelation,
      lastRelationToOrbTeam: lastRelation,
      hitSpanTicks: firstHit && lastHit ? lastHit.tick - firstHit.tick : null,
      hitSpanSeconds: firstHit && lastHit ? (lastHit.tick - firstHit.tick) / TICK_RATE : null,
      orderedHits: hits
    },
    lifecycleAnalysis: {
      eventCount: row.lifecycleEvents.length,
      endEventCount: endEvents.length,
      firstEndEventAfterFirstHit,
      firstEndEventAfterAttackableEnd,
      firstHitToEndTicks: firstHit && firstEndEventAfterFirstHit ? firstEndEventAfterFirstHit.tick - firstHit.tick : null,
      attackableEndToEndTicks: firstEndEventAfterAttackableEnd ? firstEndEventAfterAttackableEnd.tick - row.episode.attackableEndTick : null,
      events: row.lifecycleEvents
    },
    correctedOutcome
  };
}

function buildCorrectedOutcome(row, firstHit, firstRelation, distinctTeamCount) {
  if (!firstHit) return { label: 'NO_SHOT_UNRESOLVED', confidence: 'UNRESOLVED', basis: 'No player hit observed; do not call AUTO_AWARD yet.' };
  const label = outcomeLabelForRelation(row.sourceType, firstRelation);
  if (!label) return { label: 'SHOT_TEAM_RELATION_UNKNOWN', confidence: 'LOW', basis: 'Hit observed but shooter/orb team relation unresolved.' };
  if (distinctTeamCount > 1) return { label: `FIRST_HIT_PROVISIONAL_${label}`, confidence: 'MODERATE', basis: 'Both teams hit this orb; first hit is provisional.' };
  return { label, confidence: 'HIGH', basis: 'Only one attacker team generated hit telemetry for this orb.' };
}

function outcomeLabelForRelation(sourceType, relation) {
  if (!relation || relation === 'UNKNOWN') return null;

  if (sourceType === 'TROOPER_DEATH') {
    if (relation === 'SAME_ORB_TEAM') return 'DENY';
    if (relation === 'OPPOSING_ORB_TEAM') return 'SECURE';
  }

  if (sourceType === 'URN_DELIVERY') {
    if (relation === 'SAME_ORB_TEAM') return 'CLAIM';
    if (relation === 'OPPOSING_ORB_TEAM') return 'DENY';
  }

  return null;
}

function relationToOrbTeam(playerTeam, orbTeam) {
  if (!isGameTeam(playerTeam) || !isGameTeam(orbTeam)) return 'UNKNOWN';
  return playerTeam === orbTeam ? 'SAME_ORB_TEAM' : 'OPPOSING_ORB_TEAM';
}

function buildPlayerOutcomeSummary(rows) {
  const map = new Map();

  for (const row of rows) {
    const hit = row.analysis.firstHit;
    const name = hit?.attackerPlayer?.playerName;

    if (!name) continue;

    if (!map.has(name)) {
      map.set(name, {
        playerName: name,
        team: hit.attackerPlayer.team,
        totalFirstHits: 0,
        outcomes: new Map()
      });
    }

    const p = map.get(name);
    p.totalFirstHits++;

    const label = row.analysis.correctedOutcome.label;
    p.outcomes.set(label, (p.outcomes.get(label) ?? 0) + 1);
  }

  return [...map.values()]
    .map(p => ({
      playerName: p.playerName,
      team: p.team,
      totalFirstHits: p.totalFirstHits,
      outcomes: mapToSortedObject(p.outcomes)
    }))
    .sort((a, b) => b.totalFirstHits - a.totalFirstHits);
}

function buildUrnBurstOutcomeSummary(rows) {
  const map = new Map();

  for (const row of rows) {
    const id = row.sourceId ?? 'UNKNOWN';

    if (!map.has(id)) {
      map.set(id, {
        burstId: id,
        burstTeam: row?.urnBurst?.burstTeam ?? row.episode.orbTeam ?? null,
        firstClock: row?.urnBurst?.firstClock ?? row.episode.startClock ?? null,
        orbCount: 0,
        outcomes: new Map()
      });
    }

    const b = map.get(id);
    b.orbCount++;

    const label = row.analysis.correctedOutcome.label;
    b.outcomes.set(label, (b.outcomes.get(label) ?? 0) + 1);
  }

  return [...map.values()]
    .map(b => ({
      burstId: b.burstId,
      burstTeam: b.burstTeam,
      firstClock: b.firstClock,
      orbCount: b.orbCount,
      outcomes: mapToSortedObject(b.outcomes)
    }))
    .sort((a, b) => String(a.burstId).localeCompare(String(b.burstId)));
}

function compactRaceExample(row) {
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    episodeId: row.episode.episodeId,
    entityIndex: row.episode.entityIndex,
    orbTeam: row.episode.orbTeam,
    startClock: row.episode.startClock ?? null,
    correctedOutcome: row.analysis.correctedOutcome,
    raceAnalysis: row.analysis.raceAnalysis,
    firstEndEventAfterFirstHit: row.analysis.firstEndEventAfterFirstHit
  };
}

async function loadJsonl(path) {
  const rows = [];

  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) continue;

    try {
      rows.push(JSON.parse(line));
    } catch {}
  }

  return rows;
}

function countBy(rows, keyFn) {
  const map = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return map;
}

function mapToSortedObject(map) {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1])
  );
}

function summarizeNumbers(values) {
  const clean = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!clean.length) {
    return {
      count: 0,
      min: null,
      p10: null,
      p25: null,
      median: null,
      p75: null,
      p90: null,
      max: null,
      mean: null
    };
  }

  return {
    count: clean.length,
    min: clean[0],
    p10: percentile(clean, 0.10),
    p25: percentile(clean, 0.25),
    median: percentile(clean, 0.50),
    p75: percentile(clean, 0.75),
    p90: percentile(clean, 0.90),
    max: clean.at(-1),
    mean: clean.reduce((a, b) => a + b, 0) / clean.length
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];

  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);

  if (lo === hi) return sorted[lo];

  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isGameTeam(v) {
  return v === 2 || v === 3;
}

function rate(n, d) {
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0
    ? n / d
    : null;
}

function check(actual, expected, pass) {
  return {
    actual,
    expected,
    pass
  };
}

function formatPercent(v) {
  return Number.isFinite(v)
    ? `${(v * 100).toFixed(2)}%`
    : 'n/a';
}

function formatNumber(v) {
  return Number.isFinite(v)
    ? v.toFixed(3)
    : 'n/a';
}

function finishWriter(writer) {
  return new Promise((resolvePromise, rejectPromise) => {
    writer.on('error', rejectPromise);
    writer.end(resolvePromise);
  });
}