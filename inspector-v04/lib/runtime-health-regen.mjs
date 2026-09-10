export function numericSummary(values){
  const xs=(values??[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length)return{count:0,min:null,p25:null,median:null,p75:null,max:null,mean:null};
  const q=p=>{const pos=(xs.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?xs[lo]:xs[lo]+(xs[hi]-xs[lo])*(pos-lo);};
  return{count:xs.length,min:xs[0],p25:q(.25),median:q(.5),p75:q(.75),max:xs[xs.length-1],mean:xs.reduce((a,b)=>a+b,0)/xs.length};
}

export function buildHealthRegenPlayerSummary(identity,samples,{matchEndSeconds=null}={}){
  const ordered=[...(samples??[])].filter(x=>Number.isFinite(Number(x?.value))).sort((a,b)=>(a.tick??0)-(b.tick??0));
  const pregame=ordered.filter(x=>Number(x.matchTimeSeconds)<0);
  const gameplay=ordered.filter(x=>Number(x.matchTimeSeconds)>=0);
  const changes=[];
  let prev=null;
  for(const s of ordered){
    const value=Number(s.value);
    if(prev===null||value!==prev.value){
      changes.push({
        schemaVersion:'runtime_health_regen_event_v01',eventType:prev===null?'OBSERVED_HEALTH_REGEN_INITIAL':'OBSERVED_HEALTH_REGEN_CHANGED',
        tick:s.tick??null,demoSeconds:s.demoSeconds??null,matchTimeSeconds:s.matchTimeSeconds??null,
        previousValue:prev?.value??null,currentValue:value
      });
    }
    prev={value};
  }
  const gameplayValues=gameplay.map(x=>Number(x.value));
  const allValues=ordered.map(x=>Number(x.value));
  return{
    ...identity,
    sampleCount:ordered.length,pregameSampleCount:pregame.length,gameplaySampleCount:gameplay.length,
    rawObserved:numericSummary(allValues),gameplayObserved:numericSummary(gameplayValues),
    firstGameplayValue:gameplay.length?Number(gameplay[0].value):null,
    lastGameplayValue:gameplay.length?Number(gameplay[gameplay.length-1].value):null,
    changeCount:changes.filter(x=>x.eventType==='OBSERVED_HEALTH_REGEN_CHANGED').length,
    matchEndSeconds:Number.isFinite(Number(matchEndSeconds))?Number(matchEndSeconds):null,
    changeEvents:changes
  };
}
