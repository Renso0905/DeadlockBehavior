import test from'node:test';
import assert from'node:assert/strict';
import{associatePlayerDamage,buildStrictTrooperLinks,extractPlayerDamageReference,isFlyingSoulRelaunch,summarizeFlyingSoulLinks}from'../lib/runtime-flying-soul.mjs';

const death=(id,tick,team=2,x=0)=>({entityIndex:id,tick,position:{x,y:0,z:0},trooperContext:{team,subclassId:1003135509}});
const episode=(id,tick,team=2,x=0)=>({episodeId:id,entityIndex:100,startTick:tick,startPosition:{x,y:0,z:0},subclassId:'494398941',team,timeLaunch:9,attackableTime:10,endAttackableTime:10.7});

test('strict source links require mutual uniqueness, team, tick, distance, and subclass',()=>{
  const good=buildStrictTrooperLinks([death(1,10)],[episode('100|1',11)]);assert.equal(good.strictLinks.length,1);
  assert.equal(buildStrictTrooperLinks([death(1,10,2)],[episode('100|1',11,3)]).strictLinks.length,0);
  assert.equal(buildStrictTrooperLinks([death(1,10)],[episode('100|1',20)]).strictLinks.length,0);
  assert.equal(buildStrictTrooperLinks([death(1,10)],[episode('100|1',11,2,251)]).strictLinks.length,0);
  assert.equal(buildStrictTrooperLinks([death(1,10)],[{...episode('100|1',11),subclassId:'other'}]).strictLinks.length,0);
});

test('ambiguous candidate graphs are rejected rather than guessed',()=>{
  const result=buildStrictTrooperLinks([death(1,10),death(2,10,2,1)],[episode('100|1',11)]);
  assert.equal(result.strictLinks.length,0);assert.equal(result.ambiguousEpisodes,1);
});

test('attackable summary uses direct nonnegative carrier differences',()=>{
  const summary=summarizeFlyingSoulLinks([episode('1|1',1),{...episode('2|1',2),attackableTime:20,endAttackableTime:21.4}]);
  assert.equal(summary.episodes,2);assert.equal(summary.attackableWindows,2);assert.ok(Math.abs(summary.medianAttackableWindowSeconds-1.05)<1e-9);
});

test('relaunch detection accepts launch changes and rejects ordinary movement',()=>{
  const prior={launchNum:1,timeLaunch:10,position:{x:0,y:0,z:0}},ep={startTick:1};
  assert.equal(isFlyingSoulRelaunch(prior,{tick:10,launchNum:2,timeLaunch:10,position:{x:1,y:0,z:0}},ep),true);
  assert.equal(isFlyingSoulRelaunch(prior,{tick:10,launchNum:1,timeLaunch:10,position:{x:1,y:0,z:0}},ep),false);
});

test('damage references require the direct player-damage message and normalize entity handles',()=>{
  const message={type:{_code:'k_EUserMsg_Damage'},data:{entindexVictim:{value:0x4000+101},entindexAttacker:88}};
  assert.deepEqual(extractPlayerDamageReference(message),{messageType:'k_EUserMsg_Damage',victimIndex:101,attackerIndex:88});
  assert.equal(extractPlayerDamageReference({type:{_code:'k_EUserMsg_Chat'},data:message.data}),null);
});

test('damage observations use exact attackable-window victim and sampled-player identity',()=>{
  const events=[{...episode('101|1',100),entityIndex:101,attackableTime:10,endAttackableTime:10.7}];
  const players=new Map([[88,{playerId:'controller:7',controllerEntityIndex:7,pawnEntityIndex:88,playerName:'Player',team:2,heroId:1}]]);
  const result=associatePlayerDamage(events,[
    {tick:164,messageType:'k_EUserMsg_Damage',victimIndex:101,attackerIndex:88},
    {tick:228,messageType:'k_EUserMsg_Damage',victimIndex:101,attackerIndex:88},
    {tick:164,messageType:'k_EUserMsg_Damage',victimIndex:999,attackerIndex:88}
  ],players,{matchClockOffsetSeconds:30,tickRate:64});
  assert.equal(result.summary.episodesWithObservedPlayerDamage,1);assert.equal(result.summary.totalObservedPlayerDamageMessages,1);
  assert.equal(result.summary.byPlayer[0].damagedEpisodes,1);assert.equal(result.summary.byPlayer[0].damageMessages,1);
  assert.equal(result.diagnostics.outsideAcceptedAttackableEpisode,2);
});
