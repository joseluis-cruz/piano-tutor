import assert from 'node:assert/strict';
import { buildReviewEntries } from '../public/js/session/pt_review.js';

const names = new Map([[48, 'Do3'], [71, 'Si4'], [72, 'Do5'], [73, 'Do♯5'], [74, 'Re5']]);
const pitchName = pitch => names.get(pitch);
const note = (pitch, index, staff = 1, tick = 0) => ({
  pitch, staff, channel: staff - 1, startTick: tick, endTick: tick + 480,
  measure: 1, sourceMeasureIndex: 0, sourceNoteIndex: index
});
const omitted = expected => ({ expected, captured: null, match: 'OMITTED' });
const matched = (expected, diagnostics = [], pitch = expected.pitch) => ({
  expected, captured: { pitch }, match: 'MATCHED', diagnostics
});
const diagnostics = item => item.match === 'OMITTED'
  ? [{ kind: 'omitted', message: 'Has omitido esta nota.' }] : item.diagnostics;
const review = (items, notes) => buildReviewEntries(items, notes, diagnostics, pitchName);

const single = note(72, 0);
assert.equal(review([omitted(single)], [single])[0].message,
  'Mano derecha - Do5: Has omitido esta nota.');

// El encabezado incluye también las notas correctas del acorde, ordenadas.
const low = note(71, 1), high = note(74, 2);
assert.equal(review([omitted(high), omitted(low)], [high, low])[0].message,
  'Mano derecha - Si4+Re5: Has omitido estas notas.');
assert.equal(review([matched(high), omitted(low)], [high, low])[0].message,
  'Mano derecha - Si4+Re5: Has omitido Si4.');

const pitchError = { kind: 'pitch', message: 'Has interpretado Do♯5 en lugar de Do natural.' };
assert.equal(review([matched(single, [pitchError], 73)], [single])[0].message,
  'Mano derecha - Do5: Has interpretado Do♯5 en lugar de Do natural.');

// Una posición con errores en ambas manos conserva dos líneas, derecha primero.
const left = note(48, 3, 2);
const durationError = { kind: 'duration', message: 'Has mantenido una blanca cuando se esperaba una negra.' };
const timingError = { kind: 'timing', message: 'Te has retrasado el tiempo equivalente a una corchea.' };
const entries = review([matched(left, [durationError]), matched(single, [timingError])], [left, single]);
assert.deepEqual(entries[0].lines, [
  'Mano derecha - Do5: Te has retrasado el tiempo equivalente a una corchea.',
  'Mano izquierda - Do3: Has mantenido una blanca cuando se esperaba una negra.'
]);
assert.equal(entries[0].groups[0].staff, 1);

// Los ataques expandidos de un adorno conservan la nota escrita en el encabezado.
const ornamentAttack = { ...single, pitch: 74, startTick: 60 };
const ornamentItems = [matched(single), omitted(ornamentAttack)];
const ornamentReview = review(ornamentItems, [single]);
assert.equal(ornamentReview[0].tick, 0);
assert.equal(ornamentReview[0].message, 'Mano derecha - Do5: Has omitido Re5.');
ornamentAttack.pitch = 73;
assert.equal(ornamentReview[0].groups[0].items[1].expected.pitch, 74);

assert.deepEqual(review([matched(single)], [single]), []);
assert.deepEqual(review([{ match: 'UNEXPECTED', captured: { pitch: 73 } }], [single]), []);
console.log('PASS contexto musical de revisión: manos, acordes, omisiones, errores y adornos');
