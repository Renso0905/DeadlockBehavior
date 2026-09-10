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
  }),  capability('health_regen', 'Observed runtime health regeneration', 'supported', ['health_regen'], {
    integrityValidation: 'Fresh runtime_health_regen_production_v01.json and runtime_health_regen_events_v01.jsonl must be produced. CCitadelPlayerController.m_flHealthRegen is sampled directly at the PlayerState cadence; finite/nonnegative values and gameplay roster coverage are checked on every eligible replay.',
    semanticValidation: 'PlayerState(t) direct-observation authority. health_regen is the observed networked CCitadelPlayerController.m_flHealthRegen field. It is not inferred from health deltas and is not decomposed into base, item, buff, zone, or ability causes.',
    replicationStatus: 'Inherited from the strongly cross-replay replicated PlayerState(t) authority across five independent replays; direct observedRuntime.healthRegen is inside that validated state boundary.'
  }),
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
  capability('primary_fire_cadence', 'Primary weapon discharge cadence', 'supported', [
    'primary_discharges','primary_attack_rate','inter_attack_interval','next_primary_ready','ready_delay'
  ], {
    integrityValidation: 'Fresh runtime_primary_fire_production_v01.json and runtime_primary_fire_events_v01.jsonl must be produced. Every promoted discharge is a positive m_nShotNumber transition on a PrimaryWeapon entity, player-linked through the Source2 owner handle; last-attack corroboration and readiness-carrier availability are checked on every eligible replay.',
    semanticValidation: 'primary_weapon_discharge_telemetry current claim plus the promoted observed primary-attack readiness authority. Firing means observed weapon discharge, not click/trigger-pull inference. Readiness is the observed m_flNextPrimaryAttack - m_flLastAttackTime runtime carrier; static fire-rate formulas are not used as runtime authority.',
    replicationStatus: 'Primary discharge telemetry is multi-replay supported. The observed readiness carrier is strongly cross-replay replicated across rep01-rep05 (27,459/27,465 pooled sustained pairs aligned).'
  }),
  capability('runtime_trooper_death_events', 'Observed Trooper death transitions', 'supported', [
    'trooper_deaths','trooper_death_timing'
  ], {
    integrityValidation: 'Fresh runtime_trooper_deaths_production_v01.json and runtime_trooper_death_events_v01.jsonl must be produced. Every authoritative event is an observed CNPC_Trooper positive m_iHealth -> 0 transition; duplicate tick/entity death identities are rejected.',
    semanticValidation: 'trooper_death_transition current claim. Trooper death means the replicated positive m_iHealth -> 0 death transition. Timing is the observed transition timestamp. Killer, last hitter, attack method, subtype, lane/jungle classification, and Ground-Soul outcome are outside this claim.',
    replicationStatus: 'Strong independent multi-replay support through the foundational replication authority. Existing replication_trooper_deaths_v01 evidence is compared by exact tick/entity identity when present.'
  }, null, 'extended'),
  capability('runtime_ground_soul_lifecycle', 'Observed Ground Soul / AssignedGold lifecycle', 'supported', [
    'ground_soul_activations','ground_soul_targeted_activations','ground_soul_lifecycle_duration'
  ], {
    integrityValidation: 'Fresh runtime_ground_soul_lifecycle_production_v01.json and runtime_ground_soul_lifecycle_events_v01.jsonl must be produced. Activation identities are unique and completed active-to-inactive durations must be nonnegative.',
    semanticValidation: 'ground_soul_lifecycle current claim. CCitadel_Pickup_AssignedGold m_bActive defines the replicated lifecycle carrier; m_hVacuumTarget is physical target telemetry only. Inactivity is not relabeled collection or payout.',
    replicationStatus: 'Ground-Soul production/lifecycle semantics reproduced across five independent replays. Exact vacuum radius, economic recipient identity, reward allocation, and unmatched-death interpretation remain outside this capability.'
  }, null, 'extended'),
  capability('runtime_assigned_gold_economic_credit', 'Ground Soul economic recipient sets', 'supported', [
    'ground_soul_economic_credit_events','ground_soul_economic_recipient_transitions','ground_soul_multi_recipient_share','ground_soul_economic_gain'
  ], {
    integrityValidation: 'Fresh runtime_assigned_gold_economic_credit_production_v01.json and runtime_assigned_gold_economic_credit_events_v01.jsonl must be produced. Promoted recipient rows are same-team, positive, exact-terminal-tick m_nCurrencies.0000 transitions with unique pawn identity and clean integer partitioning.',
    semanticValidation: 'assigned_gold_economic_recipient_set current claim. Authority is deliberately limited to isolated, physically targeted, completed AssignedGold lifecycle terminations. m_hVacuumTarget remains physical attraction telemetry and is not used as economic-recipient identity. The economic-gain metric is the cumulative selected-player sum of observed recipient m_nCurrencies.0000 deltas from resolved events only; unresolved events are excluded.',
    replicationStatus: 'Economic recipient-set identity, recipient geometry relationship, and final integer allocation structure reproduced across five independent replays. The old exact reward-magnitude heuristic and frozen exact radii are explicitly excluded.'
  }, null, 'extended')
];

export const CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS = Object.freeze(PRODUCTION_CAPABILITIES.filter(c=>c.authorityLayer==='core').flatMap(c=>c.metricIds));
export const EXTENDED_AUTHORITATIVE_PRODUCTION_METRIC_IDS = Object.freeze(PRODUCTION_CAPABILITIES.filter(c=>c.authorityLayer==='extended').flatMap(c=>c.metricIds));
export const AUTHORITATIVE_PRODUCTION_METRIC_IDS = Object.freeze([...CORE_AUTHORITATIVE_PRODUCTION_METRIC_IDS,...EXTENDED_AUTHORITATIVE_PRODUCTION_METRIC_IDS]);

export function getProductionCapability(id) {
  return PRODUCTION_CAPABILITIES.find(c=>c.id===id) ?? null;
}

function capability(id,label,productionStatus,metricIds,validation,reason=null,authorityLayer='core') {
  return Object.freeze({id,label,productionStatus,metricIds:Object.freeze([...metricIds]),validation:Object.freeze({...validation}),reason,authorityLayer});
}
