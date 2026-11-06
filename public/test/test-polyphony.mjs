import assert from 'node:assert/strict';
import {createMeasureRecognizer} from './js/session/pt_recognizer.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const score={measures:3,ppq:480};
const note=(pitch,tick,measure,channel)=>({pitch,startTick:tick,endTick:tick+200,measure,channel});
async function run(label,notes,order,expectedHand,delay=0){
  const confirmed=[],progress=[];
  const rec=createMeasureRecognizer(score,{initialMeasure:1,fullExpectedPerformance:{events:notes},onRecognized:x=>confirmed.push(x),onProgress:x=>progress.push(x)});
  for(const item of order){rec.feed({pitch:item.pitch,time:1000+item.startTick*.5,velocity:80});if(delay)await wait(delay);}
  await wait(1700);
  assert.equal(confirmed[0]?.measure,1,`${label}: no confirmó primer compás`);
  assert.equal(confirmed[0]?.hand,expectedHand,`${label}: modo de mano incorrecto`);
  assert.ok(progress.some(x=>x.provisionalTick===order.at(-1).startTick),`${label}: cursor no llegó al último ataque`);
  console.log('PASS',label,confirmed[0].hand,progress.map(x=>x.provisionalTick));
}
// Derecha acaba en tick 240 y la izquierda tiene una nota posterior tick 720.
const right=[note(72,0,1,0),note(74,240,1,0)];
const left=[note(48,0,1,1),note(50,480,1,1),note(52,720,1,1)];
await run('final izquierdo después del derecho',[...right,...left],[right[0],left[0],right[1],left[1],left[2]],'both');
// Izquierda empieza mientras derecha calla; derecha entra en tick 480.
const r2=[note(72,480,1,0),note(74,720,1,0)];
const l2=[note(48,0,1,1),note(50,240,1,1),note(52,720,1,1)];
await run('comienzo por izquierda con silencio derecho',[...r2,...l2],[l2[0],l2[1],r2[0],r2[1],l2[2]],'both');
// Caso simétrico: la izquierda termina antes y derecha continúa.
const r3=[note(72,0,1,0),note(74,480,1,0),note(76,720,1,0)];
const l3=[note(48,0,1,1),note(50,240,1,1)];
await run('final derecho después del izquierdo',[...r3,...l3],[r3[0],l3[0],l3[1],r3[1],r3[2]],'both');
// Una mano en el primer compás, segunda mano sólo aparece en el segundo.
const notes=[note(72,0,1,0),note(74,240,1,0),note(76,480,2,0),note(48,480,2,1),note(78,720,2,0),note(50,720,2,1)];
const confirms=[];
const rec=createMeasureRecognizer({measures:2,ppq:480},{fullExpectedPerformance:{events:notes},onRecognized:x=>confirms.push(x)});
for(const n of notes.filter(n=>n.measure===1))rec.feed({pitch:n.pitch,time:1000+n.startTick,velocity:80});
assert.equal(confirms.at(-1)?.hand,'right');
for(const n of notes.filter(n=>n.measure===2))rec.feed({pitch:n.pitch,time:1000+n.startTick,velocity:80});
assert.equal(confirms.at(-1)?.hand,'both');
assert.deepEqual(confirms.at(-1)?.hands.sort(),['left','right']);
console.log('PASS detección diferida de segunda mano');
