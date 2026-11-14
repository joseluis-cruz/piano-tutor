import { groupExpectedAttacks, groupCapturedAttacks, CAPTURED_CHORD_WINDOW_MS } from './pt_attack_groups.js';

// Reconocedor estrictamente secuencial: únicamente el compás pendiente.
// La referencia completa del movimiento se mantiene inmutable.
const CHORD_WINDOW_MS=CAPTURED_CHORD_WINDOW_MS;
const MIN_BPM=20, MAX_BPM=300;
const SILENCE_GRACE_MS=1700;
// Recuperar omisiones cercanas sin saltar hasta una altura repetida lejana.
const MAX_EXPECTED_GROUP_LOOKAHEAD=3;
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
  const confirmations=new Map();
  let selectedHand=null; // Provisional RIGHT/LEFT; BOTH queda fijado al descubrir ambas.
  let attempts=[],lastMatchedAt=null,waiting=true,lastDiagnostic="";
  let consumedAttackUntil=-Infinity;
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
  function alignVariant(variant,groups){
    let cursor=0, matched=[], missed=0, unexplained=0, lateNotes=0;
    const rejectedJumps=[];
    for(const group of groups){
      const observed={...group,pitches:[...group.pitches]};
      const previous=matched.at(-1);
      if(previous){
        // Una mano puede llegar después de la ventana MIDI del acorde. Antes
        // de buscar notas repetidas más adelante, completar el ataque actual.
        const missing=[...variant.groups[previous.index].pitches];
        for(const pitch of previous.pitches){const i=missing.indexOf(pitch);if(i>=0)missing.splice(i,1);}
        observed.pitches=observed.pitches.filter(pitch=>{
          const i=missing.indexOf(pitch);
          if(i<0)return true;
          missing.splice(i,1);previous.pitches.push(pitch);lateNotes++;return false;
        });
        if(!observed.pitches.length)continue;
      }
      let index=-1, overlap=0, extra=Infinity;
      const limit=Math.min(variant.groups.length,cursor+MAX_EXPECTED_GROUP_LOOKAHEAD+1);
      for(let k=cursor;k<limit;k++){
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
      if(index<0||overlap===0){
        const distant=variant.groups.findIndex((expected,i)=>i>=limit&&expected.pitches.some(p=>observed.pitches.includes(p)));
        if(distant>=0)rejectedJumps.push({recibido:observed.pitches,indicePendiente:cursor,
          esperadoSiguiente:variant.groups[cursor]?.pitches,indiceLejano:distant,tickLejano:variant.groups[distant].tick});
        missed++;continue;
      }
      matched.push({tick:variant.groups[index].tick,time:observed.time,index,pitches:observed.pitches});
      unexplained+=extra;cursor=index+1;
    }
    const coverage=matched.length/variant.groups.length;
    const rhythmCost=relativeRhythmCost(matched);
    const quality=coverage*6+matched.length*.4-unexplained*1.5-missed*.5-rhythmCost*.6;
    return {variant,matched,coverage,quality,misses:missed,rhythmCost,lateNotes,rejectedJumps};
  }
  function select(groups){
    let best=null;
    for(const variant of byMeasure.get(pending)||[]){
      if(selectedHand==='both'&&variant.hand!=='both')continue;
      if(selectedHand&&selectedHand!=='both'&&variant.hand!==selectedHand&&variant.hand!=='both')continue;
      const candidate=alignVariant(variant,groups);
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
      const bothCandidate=alignVariant(both,groups);
      if((selectedHand==='both'||support.size===2)&&bothCandidate.matched.length)return bothCandidate;
    }
    return best;
  }
  function apply(forceSingle=false){
    clearDeferred();
    const groups=groupCapturedAttacks(attempts);
    const best=select(groups);
    onDebug('Estado del intento',{
      compas:pending,manoFijada:selectedHand,ultimoAtaque:attempts.at(-1)??null,
      gruposRecibidos:groups.length,ultimosGrupos:groups.slice(-8).map(g=>({tiempo:g.time,notas:g.pitches})),
      candidato:best?{mano:best.variant.hand,cobertura:best.coverage,calidad:best.quality,
        sinCoincidencia:best.misses,costeRitmico:best.rhythmCost,notasTardiasDelAtaque:best.lateNotes,
        saltosLejanosDescartados:best.rejectedJumps,
        esperados:best.variant.groups.map(g=>({tick:g.tick,notas:g.pitches})),
        coincidencias:best.matched}:null
    });
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
    if(best.matched.length<required||latest.index<count-1){
      onDebug('Compás pendiente',{compas:pending,motivo:best.matched.length<required?'Cobertura insuficiente':'Falta el último ataque',coincidencias:best.matched.length,requeridas:required,ultimoIndice:latest.index,totalGrupos:count});
      return;
    }
    // Un acorde final puede llegar en varios NoteOn dentro de la ventana MIDI.
    // No cerrar el compás con el primer dedo cuando faltan notas simultáneas.
    if(!forceSingle){
      const expected=[...best.variant.groups.at(-1).pitches];
      for(const pitch of latest.pitches){const i=expected.indexOf(pitch);if(i>=0)expected.splice(i,1);}
      if(expected.length){
        onDebug('Esperando notas del acorde final',{compas:pending,mano:best.variant.hand,faltan:expected,esperaMs:CHORD_WINDOW_MS+30});
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
        onDebug('Esperando posible entrada de la otra mano',{compas:pending,mano:best.variant.hand,ultimoTick:latest.tick,otroUltimoTick:otherLast,esperaMs:delay});
        deferredClosure=setTimeout(()=>{deferredClosure=null;apply(true);},delay);
        return;
      }
    }
    const measure=pending,tempo=estimateTempo(best.matched,score.ppq||480);
    if(tempo)lastTempo=tempo;
    if(best.variant.hand==='both'){hands.add('right');hands.add('left');selectedHand='both';}
    else {hands.add(best.variant.hand);selectedHand??=best.variant.hand;}
    firstConfirmed??=measure;lastConfirmed=measure;pending=measure+1;
    // Los NoteOn restantes del mismo ataque pertenecen al compás cerrado.
    // Solo se excluyen del reconocedor: la captura MIDI conserva todos ellos.
    consumedAttackUntil=latest.time+CHORD_WINDOW_MS;
    const confirmed={measure,hand:best.variant.hand,bpm:tempo??lastTempo,
      confidence:best.coverage,firstMeasure:firstConfirmed,lastMeasure:measure,
      hands:[...hands],lastTick:latest.tick,lastTime:latest.time,
      segmentStartTime:best.matched[0].time,expectedMeasure:pending};
    confirmations.set(measure,confirmed);
    onRecognized(confirmed);onDebug('Compás secuencial confirmado',{...confirmed,cierreForzado:forceSingle});
    // No perder un ataque de transición: los ataques de este compás
    // permanecen en CapturedPerformance, pero no se reevalúan aquí.
    attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";
  }
  return {
    feed({pitch,velocity,time}){
      if(!Number.isInteger(pitch)||pitch<0||pitch>=96||velocity<=0||pending>score.measures)return;
      if(time<consumedAttackUntil){onDebug('Nota del ataque ya consumido',{compas:pending,pitch,time,hasta:consumedAttackUntil});return;}
      if(attempts.length&&time-attempts.at(-1).time>SILENCE_GRACE_MS&&waiting){onDebug('Ventana vaciada por silencio',{compas:pending,ataquesDescartados:attempts.length});attempts=[];}
      attempts.push({pitch,time});
      if(attempts.length>80){onDebug('Historial limitado a 80 ataques',{compas:pending});attempts=attempts.slice(-80);}
      apply();
    },
    // La pausa/no reconocimiento no hace ninguna búsqueda en otros compases.
    enterRelocalization(){onDebug('Reinicio de evidencia por espera o pausa',{compas:pending,ataquesDescartados:attempts.length});clearDeferred();attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";},
    captureMeasure(time){return time<consumedAttackUntil?lastConfirmed:Math.min(score.measures,pending);},
    getConfirmedMeasures:()=>[...confirmations.values()].map(c=>({...c,hands:[...c.hands]})),
    rewind(measure){
      const target=Math.max(1,Math.min(score.measures,measure));
      clearDeferred();attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";consumedAttackUntil=-Infinity;
      for(const key of confirmations.keys())if(key>=target)confirmations.delete(key);
      const retained=[...confirmations.values()];
      pending=target;firstConfirmed=retained[0]?.measure??null;lastConfirmed=retained.at(-1)?.measure??null;
      lastTempo=retained.at(-1)?.bpm??null;hands.clear();
      for(const c of retained)for(const hand of c.hands)hands.add(hand);
      selectedHand=hands.size===2?'both':([...hands][0]??null);
      onDebug('Compás borrado y reconocedor rearmado',{compas:target,conservados:retained.map(c=>c.measure),manos:[...hands]});
      return target;
    },
    getProgress:()=>({firstConfirmed,lastConfirmed,expectedMeasure:pending,relocating:waiting,hands:[...hands],attemptCount:attempts.length,lastMatchedAt,selectedHand,lastTempo}),
    reset(){clearDeferred();confirmations.clear();attempts=[];lastMatchedAt=null;waiting=true;lastDiagnostic="";consumedAttackUntil=-Infinity;pending=initialMeasure;lastConfirmed=null;firstConfirmed=null;lastTempo=null;hands.clear();selectedHand=null;}
  };
}
