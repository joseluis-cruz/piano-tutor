import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/clementi-13-14-capture.json', import.meta.url), 'utf8'));
const events = Object.entries(fixture.expectedGroups).flatMap(([measure, groups]) => groups.flatMap((group, index) =>
  group.notas.map(pitch => ({ measure: Number(measure), pitch, startTick: group.tick,
    endTick: groups[index + 1]?.tick ?? group.tick + 240, channel: pitch < 70 ? 1 : 0 }))));
// Sol4 de cierre pertenece a la mano derecha; el resto de notas <70 son de izquierda.
events.find(event => event.measure === 14 && event.pitch === 67).channel = 0;
const updates = [], confirmed = [], diagnostics = [];
const rec = createMeasureRecognizer({ ppq: 480, measures: 14 }, {
  initialMeasure: 13, fullExpectedPerformance: { events },
  onProgress: result => updates.push(result), onRecognized: result => confirmed.push(result),
  onDebug: (message, data) => diagnostics.push({ message, data })
});
for (const note of fixture.captured) {
  rec.feed({ pitch: note.pitch, time: note.time, velocity: 80 });
  if (note.measure === 14 && note.time < 117500) {
    assert.notEqual(updates.at(-1).provisionalTick, 19920, 'una coincidencia lejana no puede adelantar el cursor al final');
  }
}
assert.deepEqual(confirmed.map(result => result.measure), [13, 14]);
assert.equal(confirmed[1].hand, 'both');
for (const tick of [18720, 18960, 19440, 19560, 19680, 19920]) {
  assert.ok(updates.some(update => update.provisionalTick === tick), `la captura debe reconocer tick ${tick}`);
}
assert.equal(rec.getProgress().expectedMeasure, 15);
assert.ok(diagnostics.some(entry => entry.data.candidato?.saltosLejanosDescartados
  .some(jump => jump.tickLejano === 19920 && jump.recibido.includes(67))));
rec.reset();
console.log('PASS captura real de Clementi 13–14: discrepancia Fa4/Sol4 sin saltar Re–Si–Do ni perder el compás');
