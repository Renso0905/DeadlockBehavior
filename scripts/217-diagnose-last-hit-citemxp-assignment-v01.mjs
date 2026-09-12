import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Parser, InterceptorStage } from 'deadem';

// SCRIPT 217 — LAST-HIT <-> CITEMXP ASSIGNMENT DIAGNOSTIC V0.1
// Research-only. No promotion.
//
// Script 215: m_iLastHits carrier is internally exact across six replays.
// Script 216: alternate death classes do not explain the 5,285 exact residuals;
// generic CItemXP packet activity is too dense, but m_iTeamNum transitions merit
// a focused test.
//
// This script measures whether residual last-hit credits align with:
//   A) first-observed CItemXP entities
//   B) first numeric CItemXP team observation
//   C) later numeric CItemXP team changes
// versus +10s/+30s shifted-time controls.
// "First observed" is deliberately NOT called spawn/creation authority.

const TICK_RATE = 64;
const WINDOWS = [0, 4, 8];
const DEFAULT_REPLAYS = ['test','rep01','rep02','rep03','rep04','rep05'];
const replayNames = process.argv.slice(2).filter(Boolean);
if (!replayNames.length) replayNames.push(...DEFAULT_REPLAYS);

const OUT = resolve(
  'output','cross_replay',
  'player_last_hit_citemxp_assignment_diagnostic_batch_v01.json'
);

console.log('\n========================================================');
console.log('LAST-HIT <-> CITEMXP ASSIGNMENT DIAGNOSTIC V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}\n`);

const replayResults = [];

for (const replayName of replayNames) {
  const replayPath = resolve('replays', `${replayName}.dem`);

  if (!existsSync(replayPath)) {
    replayResults.push({ replayName, success:false, status:'REPLAY_MISSING' });
    console.log(`${replayName.padEnd(10)} replay missing`);
    continue;
  }

  try {
    const raw = await collect(replayPath);
    const frozen = freezeGroups(raw);
    const result = analyzeReplay(replayName, raw, frozen);
    replayResults.push(result);

    const replayOut = resolve(
      'output', replayName,
      'player_last_hit_citemxp_assignment_diagnostic_v01.json'
    );
    mkdirSync(dirname(replayOut), { recursive:true });
    writeFileSync(replayOut, JSON.stringify(result, null, 2));

    const r0 = result.groups.residual['0'];
    console.log(
      `${replayName.padEnd(10)} credits=${String(result.counts.credits).padStart(5)} ` +
      `residual=${String(result.counts.residual).padStart(5)} ` +
      `first0=${pct(r0.firstRate).padStart(7)} ` +
      `firstTeam0=${pct(r0.firstTeamRate).padStart(7)} ` +
      `teamChange0=${pct(r0.teamChangeRate).padStart(7)}`
    );
  } catch (error) {
    replayResults.push({
      replayName, success:false, status:'EXCEPTION',
      error:error?.stack ?? String(error)
    });
    console.error(`${replayName}:`, error);
  }
}

const good = replayResults.filter(r => r.success);
const aggregate = aggregateResults(good);

const batch = {
  version:'PLAYER_LAST_HIT_CITEMXP_ASSIGNMENT_DIAGNOSTIC_BATCH_V01',
  canonical:false,
  researchOnly:true,
  createdAt:new Date().toISOString(),
  successCount:good.length,
  replayCount:replayNames.length,
  question:
    'Do residual m_iLastHits credits align with sparse CItemXP first-observation/team-assignment events above shifted-time controls?',
  authorityBoundary:
    'First-observed CItemXP is not yet a validated entity-spawn event and no CItemXP signal is promoted as a last-hit mechanism by this diagnostic.',
  aggregate,
  replays:replayResults
};

mkdirSync(dirname(OUT), { recursive:true });
writeFileSync(OUT, JSON.stringify(batch, null, 2));

printBatch(batch);

// ------------------------------------------------------------

async function collect(replayPath) {
  const parser = new Parser();

  const ctrlPrev = new Map();
  const npcPrev = new Map();
  const xpPrev = new Map();

  const creditTransitions = [];
  const npcDeaths = [];
  const xpFirst = [];
  const xpFirstTeam = [];
  const xpTeamChange = [];
  const xpVacuumChange = [];

  let minTick = Infinity;
  let maxTick = -Infinity;

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, _messagePacket, events) => {
      const tick = finite(demoPacket?.tick);
      if (tick === null) return;

      minTick = Math.min(minTick, tick);
      maxTick = Math.max(maxTick, tick);

      for (const event of events ?? []) {
        const e = event?.entity;
        if (!e) continue;

        const cls = className(e);
        const idx = entityIndex(e);
        if (!cls || idx === null) continue;

        if (cls === 'CCitadelPlayerController') {
          const name = text(safeField(e,'m_iszPlayerName'));
          if (!name || name === 'SourceTV') continue;

          const cur = {
            tick, idx, name,
            team: finite(safeField(e,'m_iTeamNum')),
            lh: finite(safeField(e,'m_iLastHits'))
          };

          const prev = ctrlPrev.get(idx);
          if (
            prev &&
            Number.isFinite(prev.lh) &&
            Number.isFinite(cur.lh) &&
            cur.lh > prev.lh
          ) {
            creditTransitions.push({
              tick, idx, playerName:name, team:cur.team,
              delta:cur.lh - prev.lh
            });
          }
          ctrlPrev.set(idx, cur);
          continue;
        }

        if (cls.startsWith('CNPC_')) {
          const key = `${cls}|${idx}`;
          const cur = {
            tick, idx, cls,
            team:finite(safeField(e,'m_iTeamNum')),
            health:finite(safeField(e,'m_iHealth'))
          };
          const prev = npcPrev.get(key);

          if (
            prev &&
            Number.isFinite(prev.health) &&
            Number.isFinite(cur.health) &&
            prev.health > 0 &&
            cur.health <= 0
          ) {
            npcDeaths.push({
              id:`npc|${cls}|${idx}|${tick}`,
              tick, idx, cls, team:cur.team
            });
          }
          npcPrev.set(key, cur);
        }

        if (cls === 'CItemXP') {
          const team = finite(safeField(e,'m_iTeamNum'));
          const vacuum = scalar(safeField(e,'m_hVacuumTarget'));
          const prev = xpPrev.get(idx);

          if (!prev) {
            xpFirst.push({
              id:`first|${idx}|${tick}`,
              tick, idx, team
            });
            if (team !== null) {
              xpFirstTeam.push({
                id:`firstTeam|${idx}|${tick}`,
                tick, idx, team
              });
            }
          } else {
            if (
              prev.team === null &&
              team !== null
            ) {
              xpFirstTeam.push({
                id:`firstTeam|${idx}|${tick}`,
                tick, idx, team
              });
            }

            if (
              prev.team !== null &&
              team !== null &&
              prev.team !== team
            ) {
              xpTeamChange.push({
                id:`teamChange|${idx}|${tick}`,
                tick, idx,
                fromTeam:prev.team,
                toTeam:team
              });
            }

            if (
              prev.vacuum !== null &&
              vacuum !== null &&
              String(prev.vacuum) !== String(vacuum)
            ) {
              xpVacuumChange.push({
                id:`vacuum|${idx}|${tick}`,
                tick, idx
              });
            }
          }

          xpPrev.set(idx, { team, vacuum });
        }
      }
    }
  );

  try {
    await parser.parse(createReadStream(replayPath));
  } finally {
    await parser.dispose();
  }

  return {
    minTick:Number.isFinite(minTick) ? minTick : null,
    maxTick:Number.isFinite(maxTick) ? maxTick : null,
    credits:expandCredits(creditTransitions),
    npcDeaths,
    xpFirst,
    xpFirstTeam,
    xpTeamChange,
    xpVacuumChange
  };
}

function freezeGroups(raw) {
  const exact = greedyMatch(
    raw.credits,
    raw.npcDeaths,
    0,
    (credit, death) => eligibleDeath(death, credit.team)
  );

  const matched = exact.matches.map((m,i) => ({
    id:`matched|${i}|${m.credit.id}`,
    tick:m.credit.tick,
    team:m.credit.team
  }));

  const residual = exact.unmatchedCredits.map((c,i) => ({
    id:`residual|${i}|${c.id}`,
    tick:c.tick,
    team:c.team,
    sourceCreditId:c.id
  }));

  const allTicks = raw.credits.map(x => x.tick).sort((a,b) => a-b);

  return {
    exactMatched:exact.matches.length,
    groups:{
      matched,
      residual,
      placebo10:makePlacebos(residual, 10*TICK_RATE, raw, allTicks),
      placebo30:makePlacebos(residual, 30*TICK_RATE, raw, allTicks)
    }
  };
}

function analyzeReplay(replayName, raw, frozen) {
  const groups = {};

  for (const [name,points] of Object.entries(frozen.groups)) {
    groups[name] = {};
    for (const w of WINDOWS) {
      groups[name][String(w)] = summarizePoints(points, raw, w);
    }
  }

  const residualCredits = frozen.groups.residual.map(p => ({
    id:p.sourceCreditId, tick:p.tick, team:p.team
  }));

  const oneToOne = {};
  for (const w of WINDOWS) {
    const first = greedyMatch(
      residualCredits, raw.xpFirst, w, () => true
    );
    const firstTeam = greedyMatch(
      residualCredits, raw.xpFirstTeam, w, () => true
    );

    oneToOne[String(w)] = {
      residualToFirstObserved:first.matches.length,
      residualToFirstObservedRate:
        div(first.matches.length, residualCredits.length),
      residualToFirstObservedTeam:firstTeam.matches.length,
      residualToFirstObservedTeamRate:
        div(firstTeam.matches.length, residualCredits.length),
      combinedExactCNPCPlusFirstObservedCoverage:
        div(
          frozen.exactMatched + first.matches.length,
          raw.credits.length
        ),
      firstObservedTeamRelation:
        relationCounts(first.matches)
    };
  }

  return {
    replayName,
    success:true,
    counts:{
      credits:raw.credits.length,
      exactMatched:frozen.exactMatched,
      residual:frozen.groups.residual.length,
      xpFirst:raw.xpFirst.length,
      xpFirstTeam:raw.xpFirstTeam.length,
      xpTeamChange:raw.xpTeamChange.length,
      xpVacuumChange:raw.xpVacuumChange.length
    },
    groups,
    oneToOne
  };
}

function summarizePoints(points, raw, w) {
  let first=0, firstTeam=0, teamChange=0, vacuumChange=0;

  for (const p of points) {
    if (near(raw.xpFirst,p.tick,w).length) first++;
    if (near(raw.xpFirstTeam,p.tick,w).length) firstTeam++;
    if (near(raw.xpTeamChange,p.tick,w).length) teamChange++;
    if (near(raw.xpVacuumChange,p.tick,w).length) vacuumChange++;
  }

  return {
    n:points.length,
    first,
    firstRate:div(first,points.length),
    firstTeam,
    firstTeamRate:div(firstTeam,points.length),
    teamChange,
    teamChangeRate:div(teamChange,points.length),
    vacuumChange,
    vacuumChangeRate:div(vacuumChange,points.length)
  };
}

function aggregateResults(rows) {
  const totals = {
    credits:0, exactMatched:0, residual:0,
    xpFirst:0, xpFirstTeam:0, xpTeamChange:0, xpVacuumChange:0
  };

  for (const r of rows) {
    for (const k of Object.keys(totals)) totals[k] += r.counts[k] ?? 0;
  }

  const groups = {};
  for (const g of ['matched','residual','placebo10','placebo30']) {
    groups[g] = {};
    for (const w of WINDOWS) {
      const key = String(w);
      const parts = rows.map(r => r.groups?.[g]?.[key]).filter(Boolean);
      const n = parts.reduce((s,x)=>s+x.n,0);
      const sum = field => parts.reduce((s,x)=>s+(x[field]??0),0);

      const first = sum('first');
      const firstTeam = sum('firstTeam');
      const teamChange = sum('teamChange');
      const vacuumChange = sum('vacuumChange');

      groups[g][key] = {
        n,
        first, firstRate:div(first,n),
        firstTeam, firstTeamRate:div(firstTeam,n),
        teamChange, teamChangeRate:div(teamChange,n),
        vacuumChange, vacuumChangeRate:div(vacuumChange,n)
      };
    }
  }

  const oneToOne = {};
  for (const w of WINDOWS) {
    const key = String(w);
    const first = rows.reduce(
      (s,r)=>s+(r.oneToOne?.[key]?.residualToFirstObserved??0),0
    );
    const firstTeam = rows.reduce(
      (s,r)=>s+(r.oneToOne?.[key]?.residualToFirstObservedTeam??0),0
    );

    oneToOne[key] = {
      residualToFirstObserved:first,
      residualToFirstObservedRate:div(first,totals.residual),
      residualToFirstObservedTeam:firstTeam,
      residualToFirstObservedTeamRate:div(firstTeam,totals.residual),
      combinedExactCNPCPlusFirstObservedCoverage:
        div(totals.exactMatched + first, totals.credits)
    };
  }

  return {
    counts:{
      ...totals,
      exactCoverageRate:div(totals.exactMatched,totals.credits)
    },
    groups,
    oneToOne
  };
}

function printBatch(batch) {
  const a = batch.aggregate;
  console.log('\n========================================================');
  console.log('BATCH CITEMXP ASSIGNMENT DIAGNOSTIC');
  console.log('========================================================');
  console.log(`Successful replays: ${batch.successCount}/${batch.replayCount}`);
  console.log(`Last-hit credits: ${a.counts.credits}`);
  console.log(`Exact CNPC matches: ${a.counts.exactMatched} (${pct(a.counts.exactCoverageRate)})`);
  console.log(`Exact residuals: ${a.counts.residual}`);
  console.log(`CItemXP first-observed: ${a.counts.xpFirst}`);
  console.log(`CItemXP first-numeric-team: ${a.counts.xpFirstTeam}`);
  console.log(`CItemXP later numeric team changes: ${a.counts.xpTeamChange}\n`);

  for (const w of WINDOWS) {
    const key = String(w);
    const label = w === 0 ? 'exact' : `±${w} ticks`;
    const r = a.groups.residual[key];
    const p10 = a.groups.placebo10[key];
    const p30 = a.groups.placebo30[key];
    const o = a.oneToOne[key];

    console.log(`${label}:`);
    console.log(`  first-observed      residual ${pct(r.firstRate)} | p10 ${pct(p10.firstRate)} | p30 ${pct(p30.firstRate)}`);
    console.log(`  first numeric team  residual ${pct(r.firstTeamRate)} | p10 ${pct(p10.firstTeamRate)} | p30 ${pct(p30.firstTeamRate)}`);
    console.log(`  later team change   residual ${pct(r.teamChangeRate)} | p10 ${pct(p10.teamChangeRate)} | p30 ${pct(p30.teamChangeRate)}`);
    console.log(`  vacuum change       residual ${pct(r.vacuumChangeRate)} | p10 ${pct(p10.vacuumChangeRate)} | p30 ${pct(p30.vacuumChangeRate)}`);
    console.log(`  1:1 residual->first ${o.residualToFirstObserved}/${a.counts.residual} = ${pct(o.residualToFirstObservedRate)}`);
    console.log(`  combined CNPC+first coverage ${pct(o.combinedExactCNPCPlusFirstObservedCoverage)}\n`);
  }

  console.log(`Output: ${OUT}`);
  console.log('\nIMPORTANT: research-only; do not promote last_hits from this diagnostic alone.\n');
}

function greedyMatch(credits, events, maxTicks, eligibility) {
  const edges = [];

  for (let ci=0; ci<credits.length; ci++) {
    for (let ei=0; ei<events.length; ei++) {
      if (eligibility && !eligibility(credits[ci],events[ei])) continue;
      const dt = events[ei].tick - credits[ci].tick;
      const adt = Math.abs(dt);
      if (adt <= maxTicks) edges.push({ci,ei,dt,adt});
    }
  }

  edges.sort((a,b)=>a.adt-b.adt || a.ci-b.ci || a.ei-b.ei);

  const uc = new Set();
  const ue = new Set();
  const matches = [];

  for (const e of edges) {
    if (uc.has(e.ci) || ue.has(e.ei)) continue;
    uc.add(e.ci);
    ue.add(e.ei);
    matches.push({
      credit:credits[e.ci],
      event:events[e.ei],
      signedTickDelta:e.dt
    });
  }

  return {
    matches,
    unmatchedCredits:
      credits.filter((_x,i)=>!uc.has(i))
  };
}

function relationCounts(matches) {
  const out = { sameTeam:0, opposingTeam:0, unknown:0 };
  for (const m of matches) {
    const a = m.credit.team;
    const b = m.event.team;
    if (!competitive(a) || !competitive(b)) out.unknown++;
    else if (a === b) out.sameTeam++;
    else out.opposingTeam++;
  }
  return out;
}

function makePlacebos(residual, offset, raw, allTicks) {
  const out = [];
  for (const p of residual) {
    const tick = p.tick + offset;
    if (tick < raw.minTick || tick > raw.maxTick) continue;
    if (hasTickWithin(allTicks,tick,8)) continue;
    out.push({ tick, team:p.team });
  }
  return out;
}

function expandCredits(transitions) {
  const out = [];
  for (const t of transitions) {
    for (let i=0; i<Math.trunc(t.delta); i++) {
      out.push({
        id:`lh|${t.idx}|${t.tick}|${i}`,
        tick:t.tick,
        team:t.team,
        playerName:t.playerName
      });
    }
  }
  return out;
}

function eligibleDeath(death, playerTeam) {
  if (!competitive(death.team) || !competitive(playerTeam)) return true;
  return death.team !== playerTeam;
}

function competitive(team) {
  return team === 2 || team === 3;
}

function near(events,tick,w) {
  return events.filter(e => Math.abs(e.tick-tick) <= w);
}

function hasTickWithin(sorted,target,radius) {
  let lo=0, hi=sorted.length;
  while (lo<hi) {
    const mid=Math.floor((lo+hi)/2);
    if (sorted[mid] < target-radius) lo=mid+1;
    else hi=mid;
  }
  return lo<sorted.length && sorted[lo] <= target+radius;
}

function div(a,b) {
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a/b : null;
}

function pct(x) {
  return Number.isFinite(x) ? `${(x*100).toFixed(2)}%` : '—';
}

function finite(x) {
  const n=Number(x);
  return Number.isFinite(n) ? n : null;
}

function scalar(x) {
  if (x === null || x === undefined) return null;
  if (['number','string','boolean'].includes(typeof x)) return x;
  try { return String(x); } catch { return null; }
}

function text(x) {
  const y=scalar(x);
  if (y === null) return null;
  const s=String(y).trim();
  return s || null;
}

function safeField(entity,name) {
  try {
    return typeof entity?.getField === 'function'
      ? entity.getField(name)
      : undefined;
  } catch { return undefined; }
}

function className(entity) {
  try {
    if (typeof entity?.getClassName === 'function') {
      const x=entity.getClassName();
      if (x) return String(x);
    }
  } catch {}
  return entity?.className ?? entity?.class?.name ?? entity?._className ?? null;
}

function entityIndex(entity) {
  const direct=finite(entity?.index ?? entity?.entityIndex);
  if (direct !== null) return direct;
  try {
    return typeof entity?.getIndex === 'function'
      ? finite(entity.getIndex())
      : null;
  } catch { return null; }
}
