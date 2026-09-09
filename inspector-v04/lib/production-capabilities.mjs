export const PRODUCTION_CAPABILITIES = [
  capability('core_state_economy', 'Core state, identity, and economy', 'supported', [
    'match_clock','match_duration','player_name','steam_id','hero_id','team','controller_entity','pawn_entity','roster','composition',
    'level','level_timing','level_rate','alive_time','dead_time','alive_share','death_count','death_timing','survival_intervals','average_life',
    'respawn_time','respawn_downtime','health','health_max','health_percent','health_minmax','low_health_25','low_health_50',
    'gold_networth','ap_networth','networth_rate','networth_checkpoints','networth_rank',
    'team_networth','team_networth_diff','player_team_share','team_ahead_time','team_behind_time','max_team_lead','max_team_deficit','largest_lead_swing'
  ], {
    integrityValidation: 'Fresh player_state.jsonl and player_state_summary.json must be produced by the current run.',
    semanticValidation: 'Current A-status PlayerState/controller timing, identity, state, and economy contracts; per-sample player-state authority traces to A151.',
    replicationStatus: 'Semantic authority is inherited from the current claim/contract layer; each production replay still receives its own run-integrity check.'
  }),
  capability('health_regen', 'Runtime health regeneration', 'not_supported', ['health_regen'], {
    integrityValidation: 'No replay-generic production carrier is currently consolidated.',
    semanticValidation: 'Metric remains A-status in the inspector contract, but Script 03 does not emit health regeneration.',
    replicationStatus: 'Research authority exists in the integrated substrate; production extraction is pending.'
  }, 'Do not infer health regeneration from health deltas. Consolidate the validated runtime carrier into a replay-generic extractor first.'),
  capability('runtime_item_ownership', 'Runtime standard-shop item ownership', 'supported', [
    'current_items','final_build','item_acquisition_time','item_acquisition_order','item_count','item_ownership_duration','item_removals','checkpoint_builds'
  ], {
    integrityValidation: 'Fresh runtime_item_ownership_production_v01.json and runtime_item_ownership_events_v01.jsonl must be produced; the Script 138 V02 catalog must be current, collision-free, and resolve every observed runtime item ID.',
    semanticValidation: 'A142 runtime_item_ownership. CCitadelPlayerController.m_vecUpgrades is interpreted as current standard-shop item ownership. Ownership exit is not called a sale; mixed add/remove is not called an upgrade.',
    replicationStatus: 'Strong cross-replay replication across five independent replays via Script 142 V02.'
  }),
  capability('runtime_permanent_buff_ownership', 'Permanent world-buff ownership', 'supported', [
    'permanent_current','permanent_acquisitions','permanent_count','permanent_by_family','permanent_value','permanent_team_diff'
  ], {
    integrityValidation: 'Fresh runtime_permanent_buff_ownership_production_v01.json and runtime_permanent_buff_events_v01.jsonl must be produced. The Script 136 V02 contract, frozen six-family value-type map, 18 subclass hashes, exact static-unit multiples, and nondecreasing in-place permanent state are checked on every replay. Zero acquisition events are valid when the carrier is intact.',
    semanticValidation: 'runtime_permanent_buff_ownership current claim. Resolved m_vecStatViewerModifierValues permanent subclass rows are cumulative permanent-pickup state; positive integral unit deltas are authoritative accumulation events. Physical producer/object attribution is not claimed.',
    replicationStatus: 'Strong cross-replay replication across five independent replays via Script 146 V01; all six families and all 18 permanent subclass candidates were covered across the cohort.'
  }),
  capability('runtime_bridge_buff_ownership', 'Bridge powerup runtime intervals', 'supported', [
    'bridge_collections','bridge_current','bridge_uptime','bridge_uptime_share','bridge_overlaps','bridge_termination','bridge_team_uptime'
  ], {
    integrityValidation: 'Fresh runtime_bridge_buff_ownership_production_v01.json and runtime_bridge_buff_events_v01.jsonl must be produced. The four frozen bridge record-key hashes, CCitadel_Pickup_Modifier carrier, <=300 HU collector gate, player-state snapshot envelope, exact death boundaries, and nonnegative interval reconstruction are checked on every replay.',
    semanticValidation: 'runtime_bridge_buff_ownership / A148 bridge runtime interval authority. m_bActive true -> false on the validated bridge world-pickup carrier is collection when nearest-player geometry satisfies the frozen <=300 HU gate. Ownership intervals use the shared resource-defined 160-second lifetime, with death termination and native match/replay censoring.',
    replicationStatus: 'Bridge world collection semantics are strongly replicated across five independent replays; the current runtime-interval authority is cross-replay replicated. Survival independently validates natural 160-second expiration and death termination; the other three families inherit the shared resource-duration contract within the authority scope.'
  }),
  capability('primary_fire_cadence', 'Primary weapon discharge cadence', 'not_supported', [
    'primary_discharges','primary_attack_rate','inter_attack_interval','next_primary_ready','ready_delay'
  ], {
    integrityValidation: 'Pending replay-generic production extractor.',
    semanticValidation: 'A004 primary weapon discharge authority. Firing means weapon discharge, not click/trigger-pull inference.',
    replicationStatus: 'Use current claim-registry replication status; production extraction is pending.'
  }, 'The effective-weapon research pipeline must be consolidated before these metrics can be produced on arbitrary replay import.')
];

export const AUTHORITATIVE_PRODUCTION_METRIC_IDS = Object.freeze(PRODUCTION_CAPABILITIES.flatMap(c=>c.metricIds));

export function getProductionCapability(id) {
  return PRODUCTION_CAPABILITIES.find(c=>c.id===id) ?? null;
}

function capability(id,label,productionStatus,metricIds,validation,reason=null) {
  return Object.freeze({id,label,productionStatus,metricIds:Object.freeze([...metricIds]),validation:Object.freeze({...validation}),reason});
}
