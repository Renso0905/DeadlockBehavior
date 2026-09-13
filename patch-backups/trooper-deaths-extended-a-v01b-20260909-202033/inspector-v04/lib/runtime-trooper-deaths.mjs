export function deriveTrooperDeathTransition(previous,current){
  const previousHealth=finite(previous?.health);
  const currentHealth=finite(current?.health);
  if(previousHealth===null || currentHealth===null || !(previousHealth>0 && currentHealth===0)) return null;
  const previousLifeState=finite(previous?.lifeState);
  const currentLifeState=finite(current?.lifeState);
  const lifeStateSignal=previousLifeState===null||currentLifeState===null?null:(previousLifeState===0&&currentLifeState>0);
  return {
    healthSignal:true,
    lifeStateSignal,
    previousHealth,
    currentHealth,
    previousLifeState,
    currentLifeState,
    maxHealth:finite(current?.maxHealth)??finite(previous?.maxHealth),
  };
}

export function buildTrooperDeathSummary(events=[]){
  const sorted=[...events].sort((a,b)=>num(a.matchTimeSeconds)-num(b.matchTimeSeconds)||num(a.tick)-num(b.tick)||num(a.entityIndex)-num(b.entityIndex));
  const times=sorted.map(e=>finite(e.matchTimeSeconds)).filter(v=>v!==null&&v>=0);
  const cumulativeTimeline=[];
  let gameplayDeaths=0;
  for(const e of sorted){
    const t=finite(e.matchTimeSeconds);
    if(t===null||t<0) continue;
    gameplayDeaths++;
    cumulativeTimeline.push({matchTime:t,tick:finite(e.tick),deaths:gameplayDeaths});
  }
  return {
    deaths:sorted.length,
    gameplayDeaths,
    pregameDeaths:sorted.length-gameplayDeaths,
    firstGameplayDeathSeconds:times.length?times[0]:null,
    medianGameplayDeathSeconds:median(times),
    lastGameplayDeathSeconds:times.length?times[times.length-1]:null,
    deathTimesSeconds:times,
    cumulativeTimeline,
  };
}

export function compareEventKeys(productionEvents,researchEvents){
  const key=e=>`${Math.trunc(num(e.tick))}:${Math.trunc(num(e.entityIndex))}`;
  const production=new Set((productionEvents??[]).map(key));
  const research=new Set((researchEvents??[]).map(key));
  let matched=0;
  for(const k of production) if(research.has(k)) matched++;
  return {
    production:production.size,
    research:research.size,
    matched,
    precision:production.size?matched/production.size:null,
    recall:research.size?matched/research.size:null,
    exact:production.size===research.size&&matched===production.size,
  };
}

function median(values){
  const a=[...(values??[])].filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
