import { groupExpectedAttacks, groupCapturedAttacks } from './pt_attack_groups.js';

// Reconocedor estrictamente secuencial: únicamente el compás pendiente.
// La referencia completa del movimiento se mantiene inmutable.
const CHORD_WINDOW_MS=75;
const MIN_BPM=20, MAX_BPM=300;
const SILENCE_GRACE_MS=1700;
function estimateTempo(pairs,ppq){
  const values=[];
  for(let i=1;i<pairs.length;i++){
    const dt=pairs[i].time-pairs[i-1].time, ticks=pairs[i].tick-pairs[i-1].tick;
    if(dt>35&&ticks>0){const bpm=60000*ticks/(dt*ppq);if(bpm>=MIN_BPM&&bpm<=MAX_BPM)values.push(bpm);}
  }
  if(!values.length)return null;
  values.sort((a,b)=>a-b);
  return Math.round(values[Math.floor(values.length/2)]);
}
export function createMeasureRecognizer(score,{initialMeasure=1,fullExpectedPerformance=null,onRecognized=()=>{},onProgress=()=>{},onDebug=()=>{}}={}){
  const events=fullExpectedPerformance?.events??[];
  const byMeasure=new Map();
  for(let measure=1;measure<=score.measures;measure++){
    const all=events.filter(e=>e.measure===measure);
    const variants=['right','left','both'].map(hand=>{
      const selected=all.filter(e=>hand==='both'||e.channel===(hand==='right'?0:1));
      return {hand,groups:groupExpectedAttacks(selected.map(e=>({pitch:e.pitch,startTick:e.startTick,endTick:e.endTick,measure:e.measure})))};
    }).filter(v=>v.groups.length);
    byMeasure.set(measure,variants);
  }
  let pending=Math.max(1,Math.min(score.measures,initialMeasure));
  let lastConfirmed=null,firstConfirmed=null,lastTempo=null;
  const hands=new Set();
  let selectedHand=null; // Provisional RIGHT/LEFT; BOTH queda fijado al descubrir ambas.
  let attempts=[],lastMatchedAt=null,waiting=true,lastDiagnostic="";
  let deferredClosure=null;
  function clearDeferred(){if(deferredClosure!==null){clearTimeout(deferredClosure);deferredClosure=null;}}
  // Cada compás se interpreta de manera independiente: ninguna puntuación
  // ni secuencia de ataques previa puede impedir reanudar el siguiente.
  // El reconocimiento es musical: alturas y orden de ataques. Las distancias
  // temporales se comparan solo como proporciones (invariantes al BPM), nunca
  // contra milisegundos absolutos de ExpectedPerformance.
  function relativeRhythmCost(matches){
    const intervals=[];
    for(let i=1;i<matches.length;i++){
      const dt=matches[i].time-matches[i-1].time;
      const ticks=matches[i].tick-matches[i-1].tick;
      if(dt>35&&ticks>0)intervals.push({dt,ticks});
    }
    if(intervals.length<2)return 0;
    const scales=intervals.map(x=>x.dt/x.ticks).sort((a,b)=>a-b);
    const reference=scales[Math.floor(scales.length/2)];
    return intervals.reduce((sum,x)=>sum+Math.min(1.5,Math.abs(Math.log((x.dt/x.ticks)/reference))),0)/intervals.length;
  }
  function select(groups){
    let best=null;
    for(const variant of byMeasure.get(pending)||[]){
      if(selectedHand==='both'&&variant.hand!=='both')continue;
      if(selectedHand&&selectedHand!=='both'&&variant.hand!==selectedHand&&variant.hand!=='both')continue;
      let cursor=0, matched=[], missed=0, unexplained=0;
      for(const observed of groups){
        let index=-1, overlap=0, extra=Infinity;
        for(let k=cursor;k<variant.groups.length;k++){
          const pool=[...variant.groups[k].pitches];
          let common=0;
          for(const pitch of observed.pitches){
            const pos=pool.indexOf(pitch);
            if(pos>=0){pool.splice(pos,1);common++;}
          }
          const unmatched=observed.pitches.length-common;
          if(common>overlap||(common===overlap&&common>0&&unmatched<extra)){
            index=k;overlap=common;extra=unmatched;
          }
          if(common===observed.pitches.length&&common>0)break;
        }
        if(index<0||overlap===0){missed++;continue;}
        matched.push({tick:variant.groups[index].tick,time:observed.time,index,pitches:observed.pitches});
        unexplained+=extra;cursor=index+1;
      }
      const coverage=matched.length/variant.groups.length;
      const rhythmCost=relativeRhythmCost(matched);
      // Preferir una mano bien explicada frente a ambas parcialmente explicadas.
      const quality=coverage*6+matched.length*.4-unexplained*1.5-missed*.5-rhythmCost*.6;
      const candidate={variant,matched,coverage,quality,misses:missed,rhythmCost};
      if(!best||candidate.quality>best.quality)best=candidate;
    }
    // La detección de manos no es un concurso de porcentajes de cobertura:
    // si hay evidencia de dos pentagramas, nunca debe ganar una variante de una mano.
    // Es crucial cuando una mano acaba antes o empieza después que la otra.
    const variants=byMeasure.get(pending)||[];
    const both=variants.find(v=>v.hand==='both');
    if(both){
      const observedPitches=groups.flatMap(g=>g.pitches);
      const support=new Set();
      for(const hand of ['right','left']){
        const variant=variants.find(v=>v.hand===hand);
        if(!variant)continue;
        // Exigimos ataques distintos: evita considerar dos manos por unísonos.
        const others=variants.find(v=>v.hand!=='both'&&v.hand!==hand);
        const exclusive=variant.groups.flatMap(g=>g.pitches).filter(p=>!others?.groups.some(g=>g.pitches.includes(p)));
        if(exclusive.some(p=>observedPitches.includes(p)))support.add(hand);
      }
      const bothCandidate=(() => {
        let cursor=0,matched=[],missed=0,unexplained=0;
        for(const observed of groups){
          let index=-1,overlap=0,extra=Infinity;
          for(let k=cursor;k<both.groups.length;k++){
            const pool=[...both.groups[k].pitches];let common=0;
            for(const pitch of observed.pitches){const pos=pool.indexOf(pitch);if(pos>=0){pool.splice(pos,1);common++;}}
            const unmatched=observed.pitches.length-common;
            if(common>overlap||(common===overlap&&common>0&&unmatched<extra)){index=k;overlap=common;extra=unmatched;}
            if(common===observed.pitches.length&&common>0)break;
          }
          if(index<0||overlap===0){missed++;continue;}
          matched.push({tick:both.groups[index].tick,time:observed.time,index,pitches:observed.pitches});
          unexplained+=extra;cursor=index+1;
        }
        return {variant:both,matched,coverage:matched.length/both.groups.length,
          quality:matched.length*.4-unexplained*1.5-missed*.5,misses:missed,rhythmCost:relativeRhythmCost(matched)};
      })();
      if((selectedHand==='both'||support.size===2)&&bothCandidate.matched.length)return bothCandidate;
    }
    return best;
  }
  function apply(forceSingle=false){
    clearDeferred();
    const groups=groupCapturedAttacks(attempts);
    const best=select(groups);
    if(!best||!best.matched.length){
      const observed=groups.at(-1)?.pitches??[];
      const expected=(byMeasure.get(pending)||[]).map(v=>({mano:v.hand,esperado:v.groups.slice(0,5).map(g=>g.pitches)}));
      const signature=JSON.stringify([pending,observed]);
      if(signature!==lastDiagnostic){onDebug('Sin coincidencia musical',{compas:pending,recibido:observed,candidatos:expected});lastDiagnostic=signature;}
      return;
    }
    lastDiagnostic="";
    const latest=best.matched.at(-1);
    if(latest.time!==lastMatchedAt){
      lastMatchedAt=latest.time;waiting=false;
      onProgress({expectedMeasure:pending,lastConfirmed,provisionalTick:latest.tick,
        provisionalTime:latest.time,provisionalHand:best.variant.hand,
        confidence:best.coverage,bpm:estimateTempo(best.matched,score.ppq||480)});
    }
    const count=best.variant.groups.length;
    const required=count<=2?count:Math.max(2,Math.ceil(count*.72));
    if(best.matched.length<required||latest.index<count-1)return;
    // Un acorde final puede llegar en varios NoteOn dentro de la ventana MIDI.
    // No cerrar el compás con el primer dedo cuando faltan notas simultáneas.
    if(best.variant.hand==='both'&&!forceSingle){
      const expected=[...best.variant.groups.at(-1).pitches];
      for(const pitch of latest.pitches){const i=expected.indexOf(pitch);if(i>=0)expected.splice(i,1);}
      if(expected.length){
        deferredClosure=setTimeout(()=>{deferredClosure=null;apply(true);},CHORD_WINDOW_MS+30);
        return;
      }
    }
    // No cerrar una mano antes de ataques posteriores escritos en la otra.
    // Cuando ambas están activas, se exige el último ataque de su unión temporal.
    // Durante el arranque, la otra mano puede comenzar más tarde.
    if(best.variant.hand!=='both'&&selectedHand!=='both'){
      const counterpart=(byMeasure.get(pending)||[]).find(v=>v.hand!=='both'&&v.hand!==best.variant.hand);
      const otherLast=counterpart?.groups.at(-1)?.tick;
      if(!forceSingle&&Number.isFinite(otherLast)&&otherLast>latest.tick){
        // La otra mano puede entrar más tarde. Conservamos el compás provisionalmente;
        // si no llega ninguna nota más, confirmamos la mano presente tras una espera acotada.
        const tempo=estimateTempo(best.matched,score.ppq||480)||lastTempo||90;
        const delay=Math.max(220,Math.min(1600,(otherLast-latest.tick)*60000/(tempo*(score.ppq||480))+180));
        deferredClosure=setTimeout(()=>{deferredClosure=null;apply(true);},delay);
        return;
      }
    }
    const measure=pending,tempo=estimateTempo(best.matched,score.ppq||480);
    if(tempo)lastTempo=tempo;
    if(best.variant.hand==='both'){hands.add('right');hands.add('left');selectedHand='both';}
    else {hands.add(best.variant.hand);selectedHand??=best.variant.hand;}
    firstConfirmed??=measure;lastConfirmed=measure;pending=measure+1;
    const confirmed={measure,hand:best.variant.hand,bpm:tempo??lastTempo,
      confidence:best.coverage,firstMeasure:firstConfirmed,lastMeasure:measure,
      hands:[...hands],lastTick:latest.tick,lastTime:latest.time,
      segmentStartTime:best.matched[0].time,expectedMeasure:pending};
    onRecognized(confirmed);onDebug('Compás secuencial confirmado',confirmed);
    // No perder un ataque de transición: los ataques de este compás
    // permanecen en CapturedPerformance, pero no se reevalúan aquí.
    attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";
  }
  return {
    feed({pitch,velocity,time}){
      if(!Number.isInteger(pitch)||pitch<0||pitch>=96||velocity<=0||pending>score.measures)return;
      if(attempts.length&&time-attempts.at(-1).time>SILENCE_GRACE_MS&&waiting){attempts=[];}
      attempts.push({pitch,time});
      if(attempts.length>80)attempts=attempts.slice(-80);
      apply();
    },
    // La pausa/no reconocimiento no hace ninguna búsqueda en otros compases.
    enterRelocalization(){clearDeferred();attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";},
    getProgress:()=>({firstConfirmed,lastConfirmed,expectedMeasure:pending,relocating:waiting,hands:[...hands]}),
    reset(){clearDeferred();attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";pending=initialMeasure;lastConfirmed=null;firstConfirmed=null;lastTempo=null;hands.clear();selectedHand=null;}
  };
}
