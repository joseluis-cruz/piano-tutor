import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSession, PT_HAND } from '../public/js/session/pt_session.js';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';

// Extraer el compás 14 del primer movimiento del MusicXML de repertorio.
// Esta lectura de la fixture solo necesita pitch/duración/staff/backup/slur.
const xml = fs.readFileSync(new URL('../public/repertoire/pieces/eem4/clementi-op36-n4.xml', import.meta.url), 'utf8');
const measure = xml.match(/<measure\b[^>]*\bnumber="14"[^>]*>[\s\S]*?<\/measure>/)[0];
assert.ok(!/<tie\b/.test(measure), 'la frase contiene ligadura de expresión, no de prolongación');
const text = (node, tag, fallback = '') => node.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] ?? fallback;
const divisions = Number([...xml.slice(0, xml.indexOf(measure)).matchAll(/<divisions>(\d+)<\/divisions>/g)].at(-1)[1]);
let tick = 0, previous = 0;
const notes = [], slurs = new Set();
for (const [node] of measure.matchAll(/<(note|backup|forward)\b[^>]*>[\s\S]*?<\/\1>/g)) {
  const duration = Number(text(node, 'duration', '0')) * 480 / divisions;
  if (node.startsWith('<backup')) { tick -= duration; continue; }
  if (node.startsWith('<forward')) { tick += duration; continue; }
  const startTick = node.includes('<chord') ? previous : tick;
  const channel = Number(text(node, 'staff', '1')) - 1;
  if (/<slur\b[^>]*type="start"/.test(node)) slurs.add(channel);
  const step = text(node, 'step');
  if (step) notes.push({ type: 'note', measure: 14, startTick, endTick: startTick + duration,
    pitch: (Number(text(node, 'octave')) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + Number(text(node, 'alter', '0')),
    channel, staff: channel + 1, voice: text(node, 'voice'), slur: slurs.has(channel) });
  if (/<slur\b[^>]*type="stop"/.test(node)) slurs.delete(channel);
  if (!node.includes('<chord')) { previous = startTick; tick += duration; }
}
const right = notes.filter(note => note.channel === 0);
assert.deepEqual(right.map(note => note.pitch), [71, 74, 71, 72, 67]);
assert.ok(right.every(note => note.slur));
const score = { ppq: 480, measures: 15, events: [
  { type: 'startOfMeasure', measure: 14, startTick: 0, beats: 3, beatType: 4 }, ...notes,
  { type: 'startOfMeasure', measure: 15, startTick: 1440, beats: 3, beatType: 4 }
] };
const expected = createSession(score, { fromMeasure: 14, toMeasure: 14, bpm: 80 },
  { evaluateHand: PT_HAND.BOTH, playbackHand: PT_HAND.NONE }).expectedPerformance;
assert.deepEqual(expected.events.filter(note => note.channel === 0).map(note => note.startTick), [0, 720, 840, 960, 1200]);

for (const bpm of [60, 80, 120, 160]) {
  for (const delayedHand of [0, 1]) {
    for (const delay of [0, 40, 90]) {
      const updates = [], confirmed = [], diagnostics = [];
      const rec = createMeasureRecognizer(score, { initialMeasure: 14, fullExpectedPerformance: expected,
        onProgress: result => updates.push(result), onRecognized: result => confirmed.push(result),
        onDebug: (message, data) => diagnostics.push({ message, data }) });
      const input = notes.map(note => ({ ...note, time: 1000 + note.startTick * 60000 / (bpm * 480) +
        (note.channel === delayedHand ? delay : 0) })).sort((a, b) => a.time - b.time);
      for (const note of input) {
        rec.feed({ pitch: note.pitch, time: note.time, velocity: 80 });
        if (note.startTick === 0) assert.equal(updates.at(-1).provisionalTick, 0, 'los dedos del primer ataque no saltan al segundo Si');
      }
      const label = `BPM ${bpm}, mano tardía ${delayedHand}, ${delay} ms`;
      assert.equal(confirmed[0]?.measure, 14, label);
      assert.equal(confirmed[0].hand, 'both', label);
      for (const note of right) assert.ok(updates.some(update => update.provisionalTick === note.startTick), `${label}: falta tick ${note.startTick}`);
      assert.equal(rec.getProgress().expectedMeasure, 15);
      if (delay === 90) assert.ok(diagnostics.some(entry => entry.data.candidato?.notasTardiasDelAtaque > 0));
      rec.reset();
    }
  }
}
console.log('PASS Clementi I, compás 14: Si-Re-Si-Do-Sol bajo ligadura, ambas manos y desfase de hasta 90 ms');
