/** Ataques musicales compartidos por reconocimiento y futura evaluación por grupos.
 * Mantiene las notas originales: agrupar nunca modifica CapturedPerformance.
 */
export const CAPTURED_CHORD_WINDOW_MS = 75;

export function groupExpectedAttacks(events) {
  const groups=[];
  for(const note of [...events].sort((a,b)=>a.startTick-b.startTick||a.pitch-b.pitch)) {
    let group=groups.at(-1);
    if(!group || Math.abs(group.tick-note.startTick)>1e-7){
      group={tick:note.startTick,notes:[],pitches:[]};groups.push(group);
    }
    group.notes.push(note);group.pitches.push(note.pitch);
  }
  return groups;
}

export function groupCapturedAttacks(events,windowMs=CAPTURED_CHORD_WINDOW_MS) {
  const groups=[];
  for(const note of [...events].sort((a,b)=>a.time-b.time)) {
    let group=groups.at(-1);
    // Ventana anclada al PRIMER ataque, no extensible por sucesivos ataques.
    if(!group || note.time-group.time>=windowMs){
      group={time:note.time,notes:[],pitches:[]};groups.push(group);
    }
    group.notes.push(note);group.pitches.push(note.pitch);
  }
  return groups;
}

/** Coste de sustitución de grupos, sin exigir orden dentro de un acorde.
 * Penalización por omisiones y añadidos, con multiconjunto (unísonos incluidos).
 */
export function attackGroupCost(expected,observed){
  const pool=[...observed.pitches];let common=0;
  for(const pitch of expected.pitches){
    const idx=pool.indexOf(pitch);
    if(idx!==-1){pool.splice(idx,1);common++;}
  }
  const missing=expected.pitches.length-common;
  return (missing+pool.length)/Math.max(1,expected.pitches.length,observed.pitches.length);
}
