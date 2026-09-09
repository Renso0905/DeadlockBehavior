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
  capability('runtime_item_ownership', 'Runtime standard-shop item ownership', 'not_supported', [
    'current_items','final_build','item_acquisition_time','item_acquisition_order','item_count','item_ownership_duration','item_removals','checkpoint_builds'
  ], {
    integrityValidation: 'Pending replay-generic production extractor.',
    semanticValidation: 'A142 runtime_item_ownership; research authority includes Scripts 140 V01, 141 V02, and 142 V02.',
    replicationStatus: 'Strong cross-replay replication across five independent replays.'
  }, 'Validated research logic has not yet been consolidated into a replay-generic production entrypoint.'),
  capability('runtime_permanent_buff_ownership', 'Permanent world-buff ownership', 'not_supported', [
    'permanent_current','permanent_acquisitions','permanent_count','permanent_by_family','permanent_value','permanent_team_diff'
  ], {
    integrityValidation: 'Pending replay-generic production extractor.',
    semanticValidation: 'A143 runtime permanent world-buff ownership contract.',
    replicationStatus: 'Use current claim-registry replication status; production extraction is pending.'
  }, 'Validated authority exists, but the extraction path is still a research-stage producer rather than a production entrypoint.'),
  capability('runtime_bridge_buff_ownership', 'Bridge powerup runtime intervals', 'not_supported', [
    'bridge_collections','bridge_current','bridge_uptime','bridge_uptime_share','bridge_overlaps','bridge_termination','bridge_team_uptime'
  ], {
    integrityValidation: 'Pending replay-generic production extractor.',
    semanticValidation: 'A148 bridge runtime interval authority.',
    replicationStatus: 'Use current claim-registry replication status; production extraction is pending.'
  }, 'Bridge acquisition/expiration reconstruction is validated at the claim layer but not consolidated for arbitrary production replay execution.'),
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
