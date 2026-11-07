import assert from 'node:assert/strict';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const note = (pitch, startTick, measure, channel = 0) => ({
  pitch, startTick, endTick: startTick + 240, measure, channel
});

// Cuatro Re+Fa; el segundo compás empieza con otro acorde y termina en Re+Fa.
// Comprobar ambas órdenes MIDI y las variantes de una y dos manos.
for (const bothHands of [false, true]) {
  for (const order of [[62, 65], [65, 62]]) {
    const notes = [
      ...[0, 240, 480, 720].flatMap(tick => [62, 65].map(pitch => note(pitch, tick, 1))),
      note(63, 960, 2), note(69, 960, 2), note(67, 1200, 2),
      note(62, 1440, 2), note(65, 1440, 2)
    ];
    if (bothHands) notes.push(note(46, 0, 1, 1), note(46, 480, 1, 1), note(46, 960, 2, 1));
    const progress = [], confirmed = [];
    const rec = createMeasureRecognizer({ measures: 2, ppq: 480 }, {
      fullExpectedPerformance: { events: notes },
      onProgress: result => progress.push(result), onRecognized: result => confirmed.push(result)
    });
    const feed = (pitch, time) => rec.feed({ pitch, time, velocity: 80 });
    for (let i = 0; i < 3; i++) {
      const time = 1000 + i * 375;
      feed(order[0], time);
      feed(order[1], time + 12);
      if (bothHands && i % 2 === 0) feed(46, time + 20);
    }
    feed(order[0], 2125);
    assert.equal(confirmed.length, 0, 'el primer dedo del acorde final no cierra el compás');
    assert.equal(progress.at(-1).provisionalTick, 720);
    feed(order[1], 2137);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].hand, bothHands ? 'both' : 'right');
    assert.equal(confirmed[0].lastTick, 720);
    assert.equal(rec.getProgress().expectedMeasure, 2);
    assert.equal(rec.captureMeasure(2150), 1, 'las notas tardías del acorde conservan el compás de captura');
    assert.equal(progress.at(-1).provisionalTick, 720, 'el segundo dedo no salta al siguiente Re+Fa');

    // Otra nota ligeramente posterior del mismo ataque tampoco abre otro compás.
    const count = progress.length;
    feed(65, 2150);
    await wait(130);
    assert.equal(progress.length, count);
    feed(63, 2500);
    feed(69, 2512);
    assert.equal(progress.at(-1).provisionalTick, 960, 'avanza al interpretar el nuevo acorde');
    rec.reset();
  }
}

// Omitir una nota del acorde final sigue permitiendo cerrar tras la espera.
const notes = [note(62, 0, 1), note(65, 0, 1), note(62, 480, 2), note(65, 480, 2)];
const confirmed = [];
const rec = createMeasureRecognizer({ measures: 2, ppq: 480 }, {
  fullExpectedPerformance: { events: notes }, onRecognized: result => confirmed.push(result)
});
rec.feed({ pitch: 62, time: 1000, velocity: 80 });
assert.equal(confirmed.length, 0);
await wait(130);
assert.equal(confirmed.length, 1, 'un acorde incompleto no bloquea indefinidamente el avance');
rec.reset();
rec.feed({ pitch: 62, time: 0, velocity: 80 });
rec.feed({ pitch: 65, time: 12, velocity: 80 });
assert.equal(confirmed.length, 2, 'reset elimina la frontera temporal de la sesión anterior');
rec.reset();
rec.feed({ pitch: 62, time: 10000, velocity: 80 });
rec.rewind(1);
await wait(130);
assert.equal(confirmed.length, 2, 'borrar cancela la confirmación diferida del intento descartado');
assert.equal(rec.getProgress().expectedMeasure, 1);
assert.equal(rec.getProgress().attemptCount, 0);
assert.equal(rec.getConfirmedMeasures().length, 0);
rec.reset();
console.log('PASS acordes entre compases: orden MIDI, una/dos manos, notas tardías, omisión y reset');
