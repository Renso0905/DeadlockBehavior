import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayModel } from './lib/replay-model.mjs';
import { METRIC_REGISTRY } from './lib/metric-registry.mjs';
import { jsonlPage, listReplayDirs, readJson, rowMatchesPlayer, sourceHealth } from './lib/io.mjs';
import { importReplay, runPipeline } from './lib/pipeline.mjs';

const inspectorRoot=fileURLToPath(new URL('.',import.meta.url));
const repoRoot=resolve(process.env.DEADLOCK_REPO_ROOT ?? join(inspectorRoot,'..'));
const outputRoot=resolve(process.env.DEADLOCK_OUTPUT_ROOT ?? join(repoRoot,'output'));
const cacheRoot=resolve(process.env.DEADLOCK_INSPECTOR_CACHE ?? join(inspectorRoot,'.cache'));
const publicRoot=join(inspectorRoot,'public');
const port=Number(process.env.DEADLOCK_INSPECTOR_PORT ?? 4177);
const host=process.env.DEADLOCK_INSPECTOR_HOST ?? '127.0.0.1';
const modelPromises=new Map();

const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||`${host}:${port}`}`);
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    return await staticFile(res,url.pathname);
  } catch(err) {
    console.error(err); sendJson(res,500,{error:err.message,stack:process.env.NODE_ENV==='development'?err.stack:undefined});
  }
});
server.listen(port,host,()=>{
  console.log(`DeadlockBehavior Inspector V04`);
  console.log(`  http://${host}:${port}`);
  console.log(`  repo:   ${repoRoot}`);
  console.log(`  output: ${outputRoot}`);
});

async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/config') return sendJson(res,200,{version:'V04',repoRoot,outputRoot,metricCount:METRIC_REGISTRY.reduce((n,s)=>n+s.metrics.length,0)});
  if(req.method==='GET'&&url.pathname==='/api/metrics') return sendJson(res,200,{sections:METRIC_REGISTRY});
  if(req.method==='GET'&&url.pathname==='/api/research/ground-soul-narrow-isolation-validation'){
    const path=join(outputRoot,'cross_replay','ground_soul_narrow_isolation_validation_v03.json');
    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul Narrow-Isolation Validation V03 has not been generated.',file:'ground_soul_narrow_isolation_validation_v03.json'});
    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul Narrow-Isolation Validation V03 could not be read.'});
    return sendJson(res,200,data);
  }
  if(req.method==='GET'&&url.pathname==='/api/replays'){
    const names=await listReplayDirs(outputRoot);const rows=[];for(const name of names){const health=await sourceHealth(join(outputRoot,name));rows.push({name,ready:health.filter(x=>x.present).length,total:health.length,coreReady:health.find(x=>x.id==='player_state')?.present===true});}
    return sendJson(res,200,{replays:rows});
  }
  let m=url.pathname.match(/^\/api\/replay\/([^/]+)\/model$/);
  if(req.method==='GET'&&m){const replay=decodeURIComponent(m[1]);const force=url.searchParams.get('force')==='1';return sendJson(res,200,await getModel(replay,force));}
  m=url.pathname.match(/^\/api\/replay\/([^/]+)\/health$/);
  if(req.method==='GET'&&m){const replay=decodeURIComponent(m[1]);return sendJson(res,200,{replay,sources:await sourceHealth(join(outputRoot,replay))});}
  m=url.pathname.match(/^\/api\/replay\/([^/]+)\/ground-soul-coverage$/);
  if(req.method==='GET'&&m){
    const replay=decodeURIComponent(m[1]);if(!/^[A-Za-z0-9._-]+$/.test(replay))throw new Error('Invalid replay name');
    const path=join(outputRoot,replay,'ground_soul_economic_coverage_audit_v01.json');
    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul economic coverage audit has not been generated for this replay.',replay,file:'ground_soul_economic_coverage_audit_v01.json'});
    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul economic coverage audit could not be read.',replay});
    return sendJson(res,200,data);
  }
  m=url.pathname.match(/^\/api\/replay\/([^/]+)\/ground-soul-collisions$/);
  if(req.method==='GET'&&m){
    const replay=decodeURIComponent(m[1]);if(!/^[A-Za-z0-9._-]+$/.test(replay))throw new Error('Invalid replay name');
    const path=join(outputRoot,replay,'ground_soul_collision_resolution_audit_v02.json');
    if(!existsSync(path))return sendJson(res,404,{error:'Ground Soul collision-resolution audit V02 has not been generated for this replay.',replay,file:'ground_soul_collision_resolution_audit_v02.json'});
    const data=await readJson(path,null);if(!data)return sendJson(res,500,{error:'Ground Soul collision-resolution audit V02 could not be read.',replay});
    return sendJson(res,200,data);
  }
  m=url.pathname.match(/^\/api\/replay\/([^/]+)\/evidence\/([^/]+)$/);
  if(req.method==='GET'&&m){return sendJson(res,200,await getEvidence(decodeURIComponent(m[1]),decodeURIComponent(m[2]),url));}
  if(req.method==='POST'&&url.pathname==='/api/import'){
    const filename=req.headers['x-filename'];if(!filename)return sendJson(res,400,{error:'Missing X-Filename header.'});
    const bytes=await readRequest(req,1024*1024*1024);const imported=await importReplay({repoRoot,filename:decodeURIComponent(String(filename)),bytes});
    return sendJson(res,201,{...imported,next:`POST /api/process/${encodeURIComponent(imported.replayName)}`});
  }
  m=url.pathname.match(/^\/api\/process\/([^/]+)$/);
  if(req.method==='POST'&&m){const replayName=decodeURIComponent(m[1]);const result=await runPipeline({repoRoot,inspectorRoot,replayName});modelPromises.delete(replayName);return sendJson(res,200,result);}
  sendJson(res,404,{error:'Not found'});
}

async function getModel(replay,force=false){
  if(!/^[A-Za-z0-9._-]+$/.test(replay))throw new Error('Invalid replay name');
  if(force)modelPromises.delete(replay);
  if(!modelPromises.has(replay))modelPromises.set(replay,buildReplayModel({outputRoot,replayName:replay,cacheRoot,force}).catch(e=>{modelPromises.delete(replay);throw e;}));
  return modelPromises.get(replay);
}

const evidenceFiles={
  breakables:['jsonl','breakable_action_stream_v1.jsonl'],
  rewards:['jsonl','breakable_reward_acquisition_v1.jsonl'],
  resources:['jsonl','behavioral_resource_episodes_v01.jsonl'],
  troopers:['jsonl','runtime_trooper_death_events_v01.jsonl'],
  groundSoulLifecycle:['jsonl','runtime_ground_soul_lifecycle_events_v01.jsonl'],
  groundSoulEconomicCredit:['jsonl','runtime_assigned_gold_economic_credit_events_v01.jsonl'],
  groundSoulCoverage:['jsonl','ground_soul_economic_coverage_audit_events_v01.jsonl'],
  groundSoulCollisions:['jsonl','ground_soul_collision_resolution_audit_events_v02.jsonl'],
  trooperResearch:['jsonl','trooper_deaths_typed_v02.jsonl'],
  groundSouls:['jsonl','trooper_ground_soul_one_to_one_v01.jsonl'],
  autoAwards:['jsonl','citemxp_auto_award_units_v02.jsonl'],
  urnBursts:['jsonl','citemxp_auto_award_urn_bursts_v02.jsonl'],
  weapon:['jsonl','runtime_primary_fire_events_v01.jsonl'],
  melee:['jsonl','verified_melee_events.jsonl'],
  playerState:['jsonl','player_state.jsonl'],
  healthRegen:['jsonl','runtime_health_regen_events_v01.jsonl'],
  orbs:['json','citemxp_inspector_events_v01.json','events'],
  items:['jsonl','runtime_item_ownership_events_v01.jsonl'],
  permanentBuffs:['jsonl','runtime_permanent_buff_events_v01.jsonl'],
  bridgeBuffs:['jsonl','runtime_bridge_buff_events_v01.jsonl'],
};
async function getEvidence(replay,kind,url){
  let def=evidenceFiles[kind];if(!def)return{error:`Unknown evidence kind: ${kind}`,available:Object.keys(evidenceFiles)};
  let path=join(outputRoot,replay,def[1]);
  if(kind==='items'&&!existsSync(path)){def=['json','integrated_authoritative_player_state_substrate_v01.json','players'];path=join(outputRoot,replay,def[1]);}
  if(kind==='weapon'&&!existsSync(path)){def=['jsonl','effective_weapon_runtime_events_v01.jsonl'];path=join(outputRoot,replay,def[1]);}
  if(!existsSync(path))return{kind,rows:[],matched:0,missing:true,file:def[1]};
  const player=url.searchParams.get('player');const offset=Math.max(0,Number(url.searchParams.get('offset')??0));const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit')??100)));
  if(def[0]==='jsonl'){
    const filterPlayer=(kind==='troopers'||kind==='groundSoulCoverage'||kind==='groundSoulCollisions')?null:player;
    const page=await jsonlPage(path,{player:filterPlayer,offset,limit});
    if(kind==='playerState'&&player)page.rows=page.rows.map(r=>{
      if(!Array.isArray(r.players)) return r;
      return {...r,players:r.players.filter(p=>String(p.playerName)===String(player))};
    });
    return{kind,file:def[1],...page};
  }
  const data=await readJson(path,{});let rows=data?.[def[2]]??[];
  if(kind==='items'){
    const flat=[];for(const p of rows){const name=p.identity?.playerName??p.playerKey;if(player&&String(name)!==String(player))continue;for(const e of p.events??[]){const causes=e.causes??[];const material=(e.itemAdds?.length??0)||(e.itemRemoves?.length??0)||causes.some(c=>String(c).includes('PERMANENT_WORLD_BUFF')||String(c).includes('BRIDGE_')||String(c)==='NATURAL_EXPIRATION');if(material)flat.push({playerName:name,...e});}}rows=flat;
  }else if(player)rows=rows.filter(r=>rowMatchesPlayer(r,player));
  const matched=rows.length;return{kind,file:def[1],matched,offset,limit,rows:rows.slice(offset,offset+limit)};
}

async function staticFile(res,pathname){
  let rel=decodeURIComponent(pathname==='/'?'/index.html':pathname).replace(/^\/+/, '');if(rel.includes('..'))return sendText(res,403,'Forbidden');
  const path=join(publicRoot,rel);if(!existsSync(path))return sendText(res,404,'Not found');
  const type=({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream';
  const st=await fs.stat(path);res.writeHead(200,{'content-type':type,'content-length':st.size,'cache-control':'no-cache'});createReadStream(path).pipe(res);
}
function sendJson(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});res.end(body);}
function sendText(res,status,body){res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(body);}
async function readRequest(req,max){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>max)throw new Error('Upload too large');chunks.push(c);}return Buffer.concat(chunks);}
