import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export async function readJson(path, fallback=null) {
  try { return JSON.parse(await fs.readFile(path,'utf8')); } catch { return fallback; }
}

export async function *readJsonl(path) {
  if (!existsSync(path)) return;
  const rl = createInterface({ input:createReadStream(path,{encoding:'utf8'}), crlfDelay:Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* preserve processing: bad rows are skipped and health exposes source file */ }
  }
}

export async function listReplayDirs(outputRoot) {
  let entries=[];
  try { entries = await fs.readdir(outputRoot,{withFileTypes:true}); } catch { return []; }
  return entries.filter(e=>e.isDirectory() && e.name !== 'cross_replay' && !e.name.startsWith('.')).map(e=>e.name).sort(replaySort);
}

export async function sourceHealth(replayDir) {
  const defs = [
    ['player_state','player_state.jsonl','A','Core state / scoreboard / trajectory'],
    ['runtime_health_regen','runtime_health_regen_production_v01.json','A','Direct observed CCitadelPlayerController.m_flHealthRegen production summary'],
    ['runtime_health_regen_events','runtime_health_regen_events_v01.jsonl','A','Observed health-regeneration change boundaries'],
    ['integrated_state','integrated_authoritative_player_state_substrate_v01.json','A','Legacy integrated items, permanent buffs, bridge intervals'],
    ['runtime_items','runtime_item_ownership_production_v01.json','A','A142 runtime standard-shop item ownership'],
    ['runtime_item_events','runtime_item_ownership_events_v01.jsonl','A','A142 ownership-entry / ownership-exit evidence'],
    ['runtime_permanent_buffs','runtime_permanent_buff_ownership_production_v01.json','A','Replicated cumulative permanent world-buff ownership'],
    ['runtime_permanent_buff_events','runtime_permanent_buff_events_v01.jsonl','A','Positive permanent-buff accumulation evidence'],
    ['runtime_bridge_buffs','runtime_bridge_buff_ownership_production_v01.json','A','A148 bridge powerup collection and runtime intervals'],
    ['runtime_bridge_buff_events','runtime_bridge_buff_events_v01.jsonl','A','A148 bridge collection evidence'],
    ['behavioral_metrics','behavioral_metrics_v02.json','B','Movement, melee, resource exposure, breakables'],
    ['resource_features','behavioral_resource_features_summary_v01.json','B','Close/core accessibility + camp exposure'],
    ['breakable_catalog','breakable_catalog_v1.json','B','Persistent breakable slots / availability'],
    ['breakable_actions','breakable_action_stream_v1.jsonl','B','Breakable event evidence'],
    ['breakable_rewards','breakable_reward_acquisition_summary_v1.json','B','Reward acquisition summaries'],
    ['breakable_reward_events','breakable_reward_acquisition_v1.jsonl','B','Reward lifecycle evidence'],
    ['runtime_trooper_deaths','runtime_trooper_deaths_production_v01.json','A','Extended A: replicated positive-health-to-zero Trooper death summary'],
    ['runtime_trooper_death_events','runtime_trooper_death_events_v01.jsonl','A','Extended A: authoritative Trooper death timing evidence'],
    ['runtime_ground_soul_lifecycle','runtime_ground_soul_lifecycle_production_v01.json','A','Extended A: replicated Ground Soul / AssignedGold lifecycle summary'],
    ['runtime_ground_soul_lifecycle_events','runtime_ground_soul_lifecycle_events_v01.jsonl','A','Extended A: Ground Soul activation, physical vacuum-target, termination, and censoring evidence'],
    ['runtime_assigned_gold_economic_credit','runtime_assigned_gold_economic_credit_production_v01.json','A','Extended A: conservative Ground Soul economic-recipient-set summary'],
    ['runtime_assigned_gold_economic_credit_events','runtime_assigned_gold_economic_credit_events_v01.jsonl','A','Extended A: resolved and unresolved AssignedGold economic-credit evidence with exact-tick recipient rows'],
    ['trooper_deaths','trooper_deaths_typed_v02.jsonl','B','Typed Trooper deaths'],
    ['ground_souls','trooper_ground_soul_one_to_one_v01.jsonl','B','Death→ground-soul one-to-one evidence'],
    ['ground_soul_summary','trooper_ground_soul_one_to_one_summary_v01.json','B','Ground-soul aggregate semantics'],
    ['citemxp','citemxp_inspector_events_v01.json','B','Flying Trooper / Urn soul objects'],
    ['auto_awards','citemxp_auto_award_units_v02.jsonl','B','No-shot automatic-award categories'],
    ['urn_bursts','citemxp_auto_award_urn_bursts_v02.jsonl','B','Urn payout bursts'],
    ['runtime_primary_fire','runtime_primary_fire_production_v01.json','A','Replay-generic observed primary discharge and readiness cadence'],
    ['runtime_primary_fire_events','runtime_primary_fire_events_v01.jsonl','A','Observed primary discharge / readiness evidence'],
    ['weapon_events','effective_weapon_runtime_events_v01.jsonl','B','Legacy/research reload and fire-mode evidence'],
    ['primary_ready','observed_primary_attack_ready_schedule_candidate_v01.json','A','Legacy single-replay readiness research artifact; production authority is the dedicated runtime primary-fire artifact'],
  ];
  const result=[];
  for (const [id,file,status,purpose] of defs) {
    const path=join(replayDir,file); let st=null;
    try { st=await fs.stat(path); } catch {}
    result.push({id,file,status,purpose,present:Boolean(st),bytes:st?.size??0,mtimeMs:st?.mtimeMs??null});
  }
  return result;
}

export async function fileFingerprint(paths) {
  const rows=[];
  for (const path of paths) {
    try { const s=await fs.stat(path); rows.push(`${path}:${s.size}:${Math.trunc(s.mtimeMs)}`); } catch { rows.push(`${path}:missing`); }
  }
  return rows.join('|');
}

export async function jsonlPage(path,{player=null,offset=0,limit=100,predicate=null}={}) {
  const rows=[]; let matched=0; let scanned=0;
  for await (const row of readJsonl(path)) {
    scanned++;
    if (player && !rowMatchesPlayer(row,player)) continue;
    if (predicate && !predicate(row)) continue;
    if (matched++ < offset) continue;
    if (rows.length < limit) rows.push(row);
  }
  return { rows, matched, scanned, offset, limit };
}

export function rowMatchesPlayer(row,player) {
  const target=String(player);
  return containsPlayerReference(row,target);
}

function containsPlayerReference(value,target,key='') {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    if (/^(positivePlayers|players)$/i.test(key) && value.some(v=>String(v)===target)) return true;
    return value.some(v=>containsPlayerReference(v,target,key));
  }
  if (typeof value !== 'object') {
    return /(playerName|playerKey|winnerPlayerName|firstHitPlayerName|shooterPlayerName|vacuumTargetPlayerName)$/i.test(key)
      && String(value)===target;
  }
  for (const [k,v] of Object.entries(value)) {
    if (containsPlayerReference(v,target,k)) return true;
  }
  return false;
}

function replaySort(a,b) {
  if (a==='test') return -1; if (b==='test') return 1;
  const na=Number(a.match(/\d+/)?.[0]??Infinity), nb=Number(b.match(/\d+/)?.[0]??Infinity);
  return na-nb || a.localeCompare(b);
}
