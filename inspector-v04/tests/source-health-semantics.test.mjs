import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReplayModel } from '../lib/replay-model.mjs';

test('replay model exposes production coverage separately from optional source-family presence', async()=>{
  const root=await mkdtemp(join(tmpdir(),'db-source-health-'));
  const out=join(root,'output','fixture');
  await mkdir(out,{recursive:true});
  const row=t=>JSON.stringify({
    demoTick:Math.round((t+30)*64),demoSeconds:t+30,matchTimeSeconds:t,
    controller:{entityIndex:1,playerName:'Alpha',steamId:'1',team:2,heroId:1,alive:true,health:500,maxHealth:500,level:1,netWorth:600,abilityPointNetWorth:0,kills:0,deaths:0,assists:0,lastHits:0,denies:0,respawnTime:0},
    pawn:{entityIndex:101,positionWorld:{x:0,y:0,z:0}}
  });
  await writeFile(join(out,'player_state.jsonl'),row(0)+'\n'+row(120)+'\n');
  await writeFile(join(out,'player_state_summary.json'),JSON.stringify({tickRateAssumed:64,matchClockOffsetSeconds:30,finalMatchTimeSeconds:120}));
  await writeFile(join(out,'production_manifest_v01.json'),JSON.stringify({
    version:'DEADLOCK_PRODUCTION_MANIFEST_V01',replayName:'fixture',runStatus:'COMPLETE_WITH_UNSUPPORTED_CAPABILITIES',
    coverage:{
      authoritativeTotal:68,completeAuthoritative:67,failedAuthoritative:0,blockedAuthoritative:0,notSupportedAuthoritative:1,unclassifiedAuthoritative:0,
      metricIds:{complete:['primary_discharges'],failed:[],blocked:[],not_supported:['health_regen'],unclassified:[]}
    }
  }));
  const model=await buildReplayModel({outputRoot:join(root,'output'),replayName:'fixture'});
  assert.equal(model.productionManifest.coverage.authoritativeTotal,68);
  assert.equal(model.productionManifest.coverage.completeAuthoritative,67);
  assert.deepEqual(model.productionManifest.coverage.metricIds.not_supported,['health_regen']);
  assert.equal(model.sourceHealth.find(x=>x.id==='integrated_state')?.present,false);
});
