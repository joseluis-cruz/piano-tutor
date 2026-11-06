import { PT_EVENT } from '../core/pt_events.js';
import { CAPTURED_CHORD_WINDOW_MS } from './pt_attack_groups.js';

// ============================================================
// Parámetros de alineamiento de interpretaciones
// ============================================================

// Con metrónomo, una nota capturada puede emparejarse con una esperada si
// su ataque cae como máximo a esta distancia temporal del ataque esperado.
const MAX_TIMING_MATCH_DEVIATION_MS = 200;

// Desviación absoluta de ataque considerada plenamente correcta en Tempo.
// Entre FULL y ZERO el cumplimiento desciende linealmente de 100 % a 0 %.
const TIMING_FULL_COMPLIANCE_MS = 15;
const TIMING_ZERO_COMPLIANCE_MS = 200;

// Desviación absoluta de duración considerada plenamente correcta.
// Hasta este valor la nota obtiene 100 % de cumplimiento en duración.
const DURATION_FULL_COMPLIANCE_MS = 50;

// Desviación absoluta de duración considerada completamente incorrecta.
// Entre FULL y ZERO el cumplimiento desciende linealmente de 100 % a 0 %.
const DURATION_ZERO_COMPLIANCE_MS = 500;

// Sin metrónomo, sólo miramos este número de notas esperadas hacia delante
// para detectar una omisión y recuperar la secuencia. Nunca se busca atrás.
const SEQUENTIAL_EXPECTED_LOOKAHEAD_NOTES = 3;

// Sin metrónomo, demasiadas notas inesperadas consecutivas significan que
// hemos perdido la secuencia y el intento deja de ser evaluable.
const MAX_CONSECUTIVE_UNEXPECTED_NOTES = 3;

export const PT_EVALUATION_STATUS = Object.freeze({
  EVALUABLE: 'EVALUABLE',
  NOT_EVALUABLE: 'NOT_EVALUABLE'
});

export const PT_MATCH = Object.freeze({
  MATCHED: 'MATCHED',
  UNEXPECTED: 'UNEXPECTED',
  OMITTED: 'OMITTED'
});

function noteEvents(performance) {
  return (performance?.events ?? []).filter(event => event.type === PT_EVENT.NOTE);
}

function duration(event) {
  return Number.isFinite(event?.timeOn) && Number.isFinite(event?.timeOff)
    ? Math.max(0, event.timeOff - event.timeOn)
    : null;
}

function matched(expected, captured) {
  const expectedDuration = duration(expected);
  const capturedDuration = duration(captured);
  return {
    match: PT_MATCH.MATCHED,
    expected,
    captured,
    deviation: {
      pitch: Math.abs(expected.pitch - captured.pitch),
      timing: Math.abs(expected.timeOn - captured.timeOn),
      duration: expectedDuration === null || capturedDuration === null
        ? null
        : Math.abs(expectedDuration - capturedDuration)
    }
  };
}

function unexpected(captured) {
  return { match: PT_MATCH.UNEXPECTED, expected: null, captured, deviation: null };
}

function omitted(expected) {
  return { match: PT_MATCH.OMITTED, expected, captured: null, deviation: null };
}

// Criterios DIDÁCTICOS compartidos con los colores y la navegación de errores.
// Una desviación aceptable no resta puntuación ni genera una marca.
export function noteErrorKinds(item,evaluation={}) {
  if(item?.match===PT_MATCH.OMITTED)return ['omitted'];
  if(item?.match===PT_MATCH.UNEXPECTED)return ['unexpected'];
  if(item?.match!==PT_MATCH.MATCHED)return [];
  const kinds=[];
  if(evaluation.pitch!==false&&item.deviation?.pitch>0)kinds.push('pitch');
  const expectedDuration=duration(item.expected),actualDuration=duration(item.captured);
  if(evaluation.timing&&expectedDuration>0&&item.deviation?.timing>=expectedDuration*0.50)kinds.push('timing');
  if(evaluation.duration&&expectedDuration>0&&Number.isFinite(actualDuration)) {
    const ratio=actualDuration/expectedDuration;
    if(ratio<0.55||ratio>1.80)kinds.push('duration');
  }
  return kinds;
}

function consolidateTimed(expectedNotes, capturedNotes) {
  const result = [];
  const used = new Set();

  for (const expected of expectedNotes) {
    const candidates = [];
    for (let i = 0; i < capturedNotes.length; i++) {
      if (used.has(i)) continue;
      const captured = capturedNotes[i];
      const timingDeviation = Math.abs(expected.timeOn - captured.timeOn);
      if (timingDeviation <= MAX_TIMING_MATCH_DEVIATION_MS) {
        candidates.push({
          index: i,
          captured,
          timingDeviation,
          pitchDeviation: Math.abs(expected.pitch - captured.pitch)
        });
      }
    }

    // Una coincidencia exacta de pitch dentro de la ventana es preferible.
    // Entre candidatos equivalentes manda la proximidad temporal.
    candidates.sort((a, b) =>
      (a.pitchDeviation === 0 ? 0 : 1) - (b.pitchDeviation === 0 ? 0 : 1) ||
      a.timingDeviation - b.timingDeviation ||
      a.pitchDeviation - b.pitchDeviation ||
      a.index - b.index
    );

    const best = candidates[0];
    if (best) {
      used.add(best.index);
      result.push(matched(expected, best.captured));
    } else {
      result.push(omitted(expected));
    }
  }

  for (let i = 0; i < capturedNotes.length; i++) {
    if (!used.has(i)) result.push(unexpected(capturedNotes[i]));
  }

  // Presentación cronológica aproximada, conservando OMITTED en su posición esperada.
  result.sort((a, b) => {
    const ta = a.expected?.timeOn ?? a.captured?.timeOn ?? 0;
    const tb = b.expected?.timeOn ?? b.captured?.timeOn ?? 0;
    return ta - tb;
  });
  return { status: PT_EVALUATION_STATUS.EVALUABLE, reason: null, items: result };
}

// La alineación libre se efectúa por grupos de ataque, no por orden de notas
// individuales dentro del acorde. Compartimos la tolerancia con el reconocedor.
const SEQUENTIAL_EXPECTED_SIMULTANEITY_MS = 1;
function groupSequential(notes,window,field){
  const groups=[];
  for(const note of [...notes].sort((a,b)=>a[field]-b[field]||a.pitch-b.pitch)){
    let group=groups.at(-1);
    if(!group||note[field]-group.time>window){
      group={time:note[field],notes:[]};groups.push(group);
    }
    group.notes.push(note);
  }
  return groups;
}
function groupOverlap(expected,captured){
  const pool=captured.notes.map(e=>e.pitch);
  let count=0;
  for(const e of expected.notes){const idx=pool.indexOf(e.pitch);if(idx>=0){pool.splice(idx,1);count++;}}
  return count;
}
function alignSequentialGroup(expected,captured){
  const result=[],remaining=[...captured.notes],unmatched=[];
  for(const note of expected.notes){
    const index=remaining.findIndex(e=>e.pitch===note.pitch);
    if(index>=0)result.push(matched(note,remaining.splice(index,1)[0]));
    else unmatched.push(note);
  }
  // Comparar también las alturas equivocadas de un acorde, sin confundir
  // las demás cabezas correctas por el orden de llegada MIDI.
  for(const note of unmatched){
    if(remaining.length){
      let best=0;
      for(let j=1;j<remaining.length;j++)if(Math.abs(remaining[j].pitch-note.pitch)<Math.abs(remaining[best].pitch-note.pitch))best=j;
      result.push(matched(note,remaining.splice(best,1)[0]));
    }else result.push(omitted(note));
  }
  for(const note of remaining)result.push(unexpected(note));
  return result;
}
function consolidateSequential(expectedNotes,capturedNotes){
  const expected=groupSequential(expectedNotes,SEQUENTIAL_EXPECTED_SIMULTANEITY_MS,'timeOn');
  const captured=groupSequential(capturedNotes,CAPTURED_CHORD_WINDOW_MS,'timeOn');
  const result=[];let index=0,consecutiveUnexpected=0,sequenceLost=false;
  for(const group of captured){
    if(sequenceLost){for(const note of group.notes)result.push(unexpected(note));continue;}
    const current=expected[index];
    if(!current){for(const note of group.notes)result.push(unexpected(note));consecutiveUnexpected+=group.notes.length;continue;}
    const currentOverlap=groupOverlap(current,group);
    let target=index;
    if(currentOverlap===0){
      const limit=Math.min(expected.length-1,index+SEQUENTIAL_EXPECTED_LOOKAHEAD_NOTES);
      for(let j=index+1;j<=limit;j++){
        if(groupOverlap(expected[j],group)>0){target=j;break;}
      }
    }
    if(target>index){
      for(let j=index;j<target;j++)for(const note of expected[j].notes)result.push(omitted(note));
      index=target;
    }
    if(groupOverlap(expected[index],group)>0){
      result.push(...alignSequentialGroup(expected[index],group));index++;consecutiveUnexpected=0;
    }else{
      // Conservar un grupo incorrecto como inesperado hasta disponer de
      // coincidencia musical: no forzar una sustitución arbitraria.
      for(const note of group.notes)result.push(unexpected(note));
      consecutiveUnexpected+=group.notes.length;
    }
    if(consecutiveUnexpected>MAX_CONSECUTIVE_UNEXPECTED_NOTES)sequenceLost=true;
  }
  for(let j=index;j<expected.length;j++)for(const note of expected[j].notes)result.push(omitted(note));
  return {status:sequenceLost?PT_EVALUATION_STATUS.NOT_EVALUABLE:PT_EVALUATION_STATUS.EVALUABLE,
    reason:sequenceLost?`Se perdió la secuencia tras más de ${MAX_CONSECUTIVE_UNEXPECTED_NOTES} notas inesperadas consecutivas.`:null,
    items:result};
}

/**
 * Consolida ExpectedPerformance y CapturedPerformance sin puntuar todavía.
 * El resultado sólo identifica correspondencias/omisiones/adiciones y mide
 * desviaciones absolutas. La política de valoración vendrá después.
 */
export function consolidatePerformance(expectedPerformance, capturedPerformance, options = {}) {
  if (!expectedPerformance || expectedPerformance.type !== 'ExpectedPerformance') throw new Error('ExpectedPerformance no válida.');
  if (!capturedPerformance || capturedPerformance.type !== 'CapturedPerformance') throw new Error('CapturedPerformance no válida.');

  const expectedNotes = noteEvents(expectedPerformance);
  const capturedNotes = noteEvents(capturedPerformance);
  const timing = Boolean(expectedPerformance.evaluation?.timing);
  // Se puede usar alineación musical libre con métricas temporales habilitadas.
  // El reconocimiento proporciona entonces anclas temporales por fragmento,
  // pero la correspondencia de acordes sigue siendo por secuencia.
  const timedAlignment = timing && options.alignmentMode !== 'SEQUENTIAL';
  const aligned = timedAlignment
    ? consolidateTimed(expectedNotes, capturedNotes)
    : consolidateSequential(expectedNotes, capturedNotes);

  return {
    type: 'ConsolidatedPerformance',
    status: aligned.status,
    reason: aligned.reason,
    alignment: {
      mode: timedAlignment ? 'TIMING' : 'SEQUENTIAL',
      maxTimingMatchDeviationMs: timedAlignment ? MAX_TIMING_MATCH_DEVIATION_MS : null,
      expectedLookaheadNotes: timedAlignment ? null : SEQUENTIAL_EXPECTED_LOOKAHEAD_NOTES,
      maxConsecutiveUnexpectedNotes: timing ? null : MAX_CONSECUTIVE_UNEXPECTED_NOTES
    },
    evaluation: { ...expectedPerformance.evaluation },
    expectedCount: expectedNotes.length,
    capturedCount: capturedNotes.length,
    passageDuration: Number.isFinite(expectedPerformance.passageDuration) ? expectedPerformance.passageDuration : null,
    items: aligned.items
  };
}

function percentage(numerator, denominator) {
  if (!(denominator > 0)) return null;
  return numerator / denominator * 100;
}

function complianceFromDeviation(deviation, denominator) {
  const deviationPercentage = percentage(deviation, denominator);
  return deviationPercentage === null ? null : Math.max(0, 100 - deviationPercentage);
}

function timingComplianceFromDeviation(deviationMs) {
  if (!Number.isFinite(deviationMs)) return null;
  if (deviationMs <= TIMING_FULL_COMPLIANCE_MS) return 100;
  if (deviationMs >= TIMING_ZERO_COMPLIANCE_MS) return 0;

  const range = TIMING_ZERO_COMPLIANCE_MS - TIMING_FULL_COMPLIANCE_MS;
  const excess = deviationMs - TIMING_FULL_COMPLIANCE_MS;
  return 100 * (1 - excess / range);
}

function durationComplianceFromDeviation(deviationMs) {
  if (!Number.isFinite(deviationMs)) return null;
  if (deviationMs <= DURATION_FULL_COMPLIANCE_MS) return 100;
  if (deviationMs >= DURATION_ZERO_COMPLIANCE_MS) return 0;

  const range = DURATION_ZERO_COMPLIANCE_MS - DURATION_FULL_COMPLIANCE_MS;
  const excess = deviationMs - DURATION_FULL_COMPLIANCE_MS;
  return 100 * (1 - excess / range);
}

/**
 * Segunda pasada del evaluador: resume un ConsolidatedPerformance sin
 * introducir todavía tolerancias, calificaciones ni juicios pedagógicos.
 * Todas las métricas de cumplimiento tienen 100 como resultado ideal.
 */
export function consolidateResults(consolidatedPerformance) {
  if (!consolidatedPerformance || consolidatedPerformance.type !== 'ConsolidatedPerformance') {
    throw new Error('ConsolidatedPerformance no válida.');
  }

  function summarize(items, expectedCount = null, capturedCount = null, passageDuration = null) {
    const expectedItems = items.filter(item => item.expected);
    const expectedNotes = expectedCount ?? expectedItems.length;
    const matchedItems = items.filter(item => item.match === PT_MATCH.MATCHED);
    const omittedNotes = items.filter(item => item.match === PT_MATCH.OMITTED).length;
    const unexpectedNotes = items.filter(item => item.match === PT_MATCH.UNEXPECTED).length;
    const correctPitchNotes = matchedItems.filter(item => item.deviation?.pitch === 0).length;
    const timingDeviationTotal = matchedItems.reduce((sum,item)=>sum+(Number.isFinite(item.deviation?.timing)?item.deviation.timing:0),0);
    const durationDeviationTotal = matchedItems.reduce((sum,item)=>sum+(Number.isFinite(item.deviation?.duration)?item.deviation.duration:0),0);
    const timingCorrect = matchedItems.filter(item=>!noteErrorKinds(item,consolidatedPerformance.evaluation).includes('timing')).length;
    const durationCorrect = matchedItems.filter(item=>!noteErrorKinds(item,consolidatedPerformance.evaluation).includes('duration')).length;
    const expectedDurationTotal = expectedItems.reduce((sum,item)=>{const d=duration(item.expected);return sum+(Number.isFinite(d)?d:0);},0);
    let interpretationDuration=passageDuration;
    if (!(interpretationDuration > 0) && expectedItems.length) {
      const starts=expectedItems.map(item=>item.expected.timeOn).filter(Number.isFinite);
      const ends=expectedItems.map(item=>item.expected.timeOff).filter(Number.isFinite);
      if(starts.length&&ends.length) interpretationDuration=Math.max(0,Math.max(...ends)-Math.min(...starts));
    }
    const omittedPercentage=percentage(omittedNotes,expectedNotes);
    const unexpectedPercentage=percentage(unexpectedNotes,expectedNotes);
    // Tempo se valora nota a nota: 100 % hasta FULL y caída lineal hasta ZERO.
    // Las OMITTED aportan 0 % porque permanecen en el denominador EXPECTED.
    const timingCompliance=expectedNotes>0?100*timingCorrect/expectedNotes:null;
    // Duración se valora nota a nota: 100 % hasta FULL, caída lineal hasta ZERO.
    // Las OMITTED no suman nada, pero sí permanecen en el denominador EXPECTED.
    const durationCompliance=expectedNotes>0?100*durationCorrect/expectedNotes:null;
    return {
      counts:{expected:expectedNotes,captured:capturedCount??matchedItems.length+unexpectedNotes,matched:matchedItems.length,correctPitch:correctPitchNotes,omitted:omittedNotes,unexpected:unexpectedNotes},
      totals:{timingDeviation:timingDeviationTotal,durationDeviation:durationDeviationTotal,interpretationDuration:interpretationDuration??null,expectedNotesDuration:expectedDurationTotal},
      percentages:{
        notesCompliance:expectedNotes>0?Math.max(0,100-(omittedPercentage??0)-(unexpectedPercentage??0)):null,
        pitchCompliance:percentage(correctPitchNotes,expectedNotes),
        timingCompliance,
        durationCompliance,
        velocityCompliance:null,
        omitted:omittedPercentage,unexpected:unexpectedPercentage
      }
    };
  }

  const items=consolidatedPerformance.items??[];
  const expectedMeasures=[...new Set(items.map(i=>i.expected?.measure).filter(Number.isFinite))].sort((a,b)=>a-b);
  const assigned=new Map(expectedMeasures.map(measure=>[measure,[]]));
  // Cada evento se atribuye a un único compás. Las notas inesperadas de la
  // alineación secuencial heredan la posición del último evento esperado
  // encontrado (o del siguiente si están al principio del pasaje).
  // De esta forma ninguna penalización queda oculta sólo en el global.
  for(let index=0;index<items.length;index++){
    const item=items[index];
    let measure=item.expected?.measure;
    if(!Number.isFinite(measure)){
      if(consolidatedPerformance.alignment?.mode==='TIMING' && Number.isFinite(item.captured?.timeOn)){
        let best=Infinity;
        for(const expected of items){
          if(!Number.isFinite(expected.expected?.measure)||!Number.isFinite(expected.expected?.timeOn))continue;
          const delta=Math.abs(item.captured.timeOn-expected.expected.timeOn);
          if(delta<best){best=delta;measure=expected.expected.measure;}
        }
      }else{
        for(let j=index-1;j>=0;j--){if(Number.isFinite(items[j].expected?.measure)){measure=items[j].expected.measure;break;}}
        if(!Number.isFinite(measure))for(let j=index+1;j<items.length;j++){
          if(Number.isFinite(items[j].expected?.measure)){measure=items[j].expected.measure;break;}
        }
      }
    }
    if(Number.isFinite(measure)&&assigned.has(measure))assigned.get(measure).push(item);
  }
  const byMeasure=expectedMeasures.map(measure=>{
    const measureItems=assigned.get(measure);
    const expectedItems=measureItems.filter(i=>i.expected);
    const starts=expectedItems.map(i=>i.expected?.timeOn).filter(Number.isFinite);
    const ends=expectedItems.map(i=>i.expected?.timeOff).filter(Number.isFinite);
    const span=starts.length&&ends.length?Math.max(0,Math.max(...ends)-Math.min(...starts)):null;
    const summary=summarize(measureItems,expectedItems.length,null,span);
    const enabled=[];
    if(Number.isFinite(summary.percentages.notesCompliance)) enabled.push(summary.percentages.notesCompliance);
    if(consolidatedPerformance.evaluation?.pitch!==false && Number.isFinite(summary.percentages.pitchCompliance)) enabled.push(summary.percentages.pitchCompliance);
    if(consolidatedPerformance.evaluation?.timing && Number.isFinite(summary.percentages.timingCompliance)) enabled.push(summary.percentages.timingCompliance);
    if(consolidatedPerformance.evaluation?.duration && Number.isFinite(summary.percentages.durationCompliance)) enabled.push(summary.percentages.durationCompliance);
    if(consolidatedPerformance.evaluation?.dynamics && Number.isFinite(summary.percentages.velocityCompliance)) enabled.push(summary.percentages.velocityCompliance);
    return {measure,...summary,compliance:enabled.length?Math.min(...enabled):null};
  });
  // Agregar numeradores/denominadores, nunca promediar porcentajes de compases.
  const total=(path)=>byMeasure.reduce((sum,row)=>sum+path(row),0);
  const expected=total(r=>r.counts.expected);
  const matchedCount=total(r=>r.counts.matched);
  const omittedCount=total(r=>r.counts.omitted);
  const unexpectedCount=total(r=>r.counts.unexpected);
  const correctPitch=total(r=>r.counts.correctPitch);
  const global={
    counts:{expected,captured:total(r=>r.counts.captured),matched:matchedCount,correctPitch,omitted:omittedCount,unexpected:unexpectedCount},
    totals:{timingDeviation:total(r=>r.totals.timingDeviation),durationDeviation:total(r=>r.totals.durationDeviation),
      interpretationDuration:consolidatedPerformance.passageDuration??null,
      expectedNotesDuration:total(r=>r.totals.expectedNotesDuration)},
    percentages:{
      notesCompliance:expected>0?Math.max(0,100*(expected-omittedCount-unexpectedCount)/expected):null,
      pitchCompliance:percentage(correctPitch,expected),
      timingCompliance:expected>0?total(r=>(r.percentages.timingCompliance??0)*r.counts.expected)/expected:null,
      durationCompliance:expected>0?total(r=>(r.percentages.durationCompliance??0)*r.counts.expected)/expected:null,
      velocityCompliance:null,
      omitted:percentage(omittedCount,expected),unexpected:percentage(unexpectedCount,expected)
    }
  };

  return {type:'ConsolidatedResults',status:consolidatedPerformance.status,reason:consolidatedPerformance.reason,evaluation:{...consolidatedPerformance.evaluation},...global,byMeasure};
}
