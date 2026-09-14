import { PRODUCTION_METRIC_CONTRACT } from '../../src/contracts/production-metric-contract.mjs';

const scalarPaths={player_name:'playerName',steam_id:'identity.steamId',hero_id:'heroId',team:'team',controller_entity:'identity.controllerEntityIndex',pawn_entity:'identity.pawnEntityIndex',level:'core.level',health:'core.health',health_max:'core.healthMax',health_percent:'core.healthPercent',gold_networth:'scoreboard.goldNetWorth',ap_networth:'scoreboard.apNetWorth',kills:'scoreboard.kills',assists:'scoreboard.assists',last_hits:'scoreboard.lastHits',denies:'scoreboard.denies',deaths_scoreboard:'scoreboard.deaths'};
const familyPaths={health_regen:'healthRegen',runtime_item_ownership:'items',runtime_permanent_buff_ownership:'permanentBuffs',runtime_bridge_buff_ownership:'bridgeBuffs',primary_fire_cadence:'weapon',runtime_melee_execution:'melee'};
const modelPaths={runtime_trooper_death_events:'troopers',runtime_flying_soul_lifecycle:'flyingSouls',runtime_ground_soul_lifecycle:'groundSoulLifecycle',runtime_assigned_gold_economic_credit:'groundSoulEconomicCredit'};
function at(object,path){return path.split('.').reduce((x,k)=>x?.[k],object);}
export function attachMetricAvailability(model){
  model.metricAvailability={};
  for(const metric of PRODUCTION_METRIC_CONTRACT.metrics){
    const producer=PRODUCTION_METRIC_CONTRACT.producers.find(x=>x.producerStageId===metric.producerStageId);
    let reason=model.productionReadiness?.available?null:model.productionReadiness?.reason??'Run has not been validated.';
    if(!reason&&modelPaths[metric.capabilityId]&&!model[modelPaths[metric.capabilityId]])reason='Validated production family is missing from the model.';
    const base={available:!reason,reason,runId:model.productionManifest?.runId??null,producerId:metric.producerStageId,sourceFiles:producer?.expectedOutputs?.map(x=>x.path.split('/').at(-1))??[],claimId:metric.primaryClaimId};
    model.metricAvailability[metric.metricId]=base;
    for(const player of model.players){
      player.metricAvailability??={};let why=reason;
      const family=familyPaths[metric.capabilityId];if(!why&&family&&!player[family])why='No validated production data for this player.';
      if(!why&&metric.metricId==='ground_soul_vacuum_target'&&!model.groundSoulLifecycle?.summary?.physicalVacuumTargets)why='Physical vacuum-target attribution was not produced.';
      if(!why&&['orb_shot_no_shot','orb_shooter','orb_multi_hit','orb_multi_player','orb_mixed_team','orb_hits'].includes(metric.metricId)&&!model.flyingSouls?.summary?.damageObservation)why='Validated flying-soul damage observations were not produced.';
      const scalar=scalarPaths[metric.metricId];if(!why&&scalar&&at(player,scalar)==null)why='The required player field was not observed.';
      const id=metric.metricId;
      const fields=id==='kda'?['kills','deaths','assists']:id==='scoreboard_timeline'?['kills','deaths','assists','lastHits','denies']:id.startsWith('health')||id.startsWith('low_health')?['health','healthMax']:id.includes('networth')||['team_ahead_time','team_behind_time','max_team_lead','max_team_deficit','largest_lead_swing'].includes(id)?['goldNetWorth']:id.startsWith('level')?['level']:['kills','kills_rate','kd','kda'].includes(id)?['kills','deaths']:['assists','assists_rate'].includes(id)?['assists']:['last_hits','last_hits_rate'].includes(id)?['lastHits']:['denies','denies_rate'].includes(id)?['denies']:[];
      const teamScoped=id.startsWith('team_')||['player_team_share','max_team_lead','max_team_deficit','largest_lead_swing'].includes(id);
      if(!why&&(teamScoped?model.players:[player]).some(p=>fields.some(field=>p.missingFields?.[field]>0)))why='Required telemetry is incomplete in the observed interval.';
      if(!why&&id==='position_trajectory'&&!player.movement?.trajectory?.length)why='No finite position observations.';
      if(!why&&['xy_distance','xyz_distance','distance_per_min','distance_per_alive_min','mean_xy_speed','mean_xyz_speed','moving_time','moving_share','low_motion_time','low_motion_share'].includes(id)&&!player.movement?.acceptedStepCount)why='No valid movement observation steps.';
      if(!why&&['alive_time','dead_time','alive_share','average_life','survival_intervals','respawn_time','respawn_downtime','death_count','death_timing','low_health_25','low_health_50'].includes(metric.metricId)&&player.core?.unknownStateSeconds>0)why='Alive/dead telemetry contains an observation gap.';
      player.metricAvailability[metric.metricId]={...base,available:!why,reason:why};
    }
  }
}
