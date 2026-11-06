import {createMeasureRecognizer} from './js/session/pt_recognizer.js';
import assert from 'node:assert/strict';
const score={measures:2,ppq:480};
const notes=[
...[[60,0],[62,240],[64,480],[65,720]].map(([pitch,startTick])=>({pitch,startTick,endTick:startTick+200,measure:1,channel:0})),
...[[48,0],[50,480]].map(([pitch,startTick])=>({pitch,startTick,endTick:startTick+300,measure:1,channel:1})),
{pitch:67,startTick:960,endTick:1200,measure:2,channel:0},
{pitch:52,startTick:960,endTick:1200,measure:2,channel:1}
];
for(const factor of [.6,1,2.2]){
 for(const hand of ['right','left','both']){
  const confirmed=[],progress=[];
  const rec=createMeasureRecognizer(score,{fullExpectedPerformance:{events:notes},onRecognized:x=>confirmed.push(x),onProgress:x=>progress.push(x)});
  const targets=notes.filter(n=>n.measure===1&&(hand==='both'||n.channel===(hand==='right'?0:1)));
  for(const [i,tick] of [...new Set(targets.map(n=>n.startTick))].entries()){
    for(const n of targets.filter(n=>n.startTick===tick))rec.feed({pitch:n.pitch,velocity:80,time:1000+tick*factor});
  }
  await new Promise(resolve=>setTimeout(resolve,1700));
  assert.equal(confirmed[0]?.measure,1,`${hand} factor=${factor}`);
  assert.ok(progress.length>0);
  console.log('PASS',hand,factor,'updates',progress.length,'bpm',confirmed[0].bpm);
 }
}
