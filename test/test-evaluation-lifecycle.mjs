import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
function appFunction(name) {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  const rest = app.slice(start);
  const end = rest.indexOf('\n}');
  return rest.slice(0, end + 2);
}
const empty = () => ({ replaceChildren() { this.cleared = true; } });
let renders = 0, stops = 0, starts = 0;
const state = {
  evaluationRenderPromise: Promise.resolve(),
  evaluatedStaffs: new Set([1]), evaluatedNotes: new Map([['old', 'pitch']]), evaluatedMeasures: new Map([[1, 'red']]),
  evaluatedMessages: new Map([['old', ['error']]]), evaluatedUnexpected: [{}],
  reviewEntries: [{}], reviewIndex: 0, reviewMessage: 'error', reviewMode: true,
  showEvaluationMeasureBackgrounds: true, resultsEmpty: { hidden: true },
  resultsContent: { hidden: false }, resultsBars: empty(), resultsMeasures: empty(), resultsMeasuresHead: {},
  lastCursorTick: 480, osmd: {}, xmlText: '<score/>',
  leaveEditMode() { state.reviewMode = false; },
  async renderScore(xml) {
    assert.equal(xml, '<score/>');
    assert.equal(state.evaluatedNotes.size, 0, 'el render no hereda colores de evaluación');
    renders++;
  },
  moveScoreCursor() {}, showPassageStart() { starts++; },
  activeListening: false, playbackState: 'STOPPED', PT_PLAYBACK_STATE: { STOPPED: 'STOPPED' },
  isRecording: () => false,
  async fullStop() { stops++; state.playbackState = 'STOPPED'; }
};
vm.createContext(state);
vm.runInContext(appFunction('resetEvaluationPresentation'), state);
vm.runInContext(appFunction('keyboardStop'), state);
await state.keyboardStop();
assert.equal(stops, 1);
assert.equal(renders, 1);
assert.equal(starts, 1);
assert.equal(state.evaluatedNotes.size + state.evaluatedMeasures.size + state.evaluatedMessages.size, 0);
assert.equal(state.evaluatedUnexpected.length + state.reviewEntries.length, 0);
assert.equal(state.evaluatedStaffs.size, 0);
assert.equal(state.reviewIndex, -1);
assert.equal(state.reviewMode, false);
assert.equal(state.resultsEmpty.hidden, false);
assert.equal(state.resultsContent.hidden, true);
assert.ok(state.resultsBars.cleared && state.resultsMeasures.cleared);

state.playbackState = 'PLAYING';
await state.keyboardStop();
assert.equal(renders, 1, 'el primer STOP de una sesión conserva la evaluación');
state.activeListening = true;
await state.keyboardStop();
assert.equal(renders, 1, 'STOP de Escucha activa tampoco descarta su resultado');

// Esperar el render anterior antes de eliminar sus datos.
let finish;
state.evaluationRenderPromise = new Promise(resolve => { finish = resolve; });
state.evaluatedNotes.set('old', 'pitch');
const resetting = state.resetEvaluationPresentation();
await Promise.resolve();
assert.equal(state.evaluatedNotes.size, 1);
finish(); await resetting;
assert.equal(state.evaluatedNotes.size, 0);

// Activar un movimiento (también al cargar una pieza) elimina el resultado previo.
Object.assign(state, {
  sourceXmlText: '<score/>', movements: [{}], movementInput: {}, currentSession: { old: true },
  forceStopBeforeMusicLoad: async () => {}, movementXml: () => '<score/>',
  buildCanonical() {}, initialLessonForScore: () => ({}), updateLessonUI() {},
  setPlaybackState() {}
});
state.evaluatedNotes.set('old', 'pitch');
state.resultsContent.hidden = false;
vm.runInContext(appFunction('activateMovement'), state);
await state.activateMovement(0);
assert.equal(state.evaluatedNotes.size, 0);
assert.equal(state.currentSession, null);
assert.equal(state.resultsContent.hidden, true);
assert.equal(renders, 2);

// Ciclar el modo estando parado solo modifica y persiste la preferencia.
Object.assign(state, {
  activeListening: false, activeMetronomeMode: 'off',
  persistMetronomeMode() { state.persistedMode = state.activeMetronomeMode; },
  updateActiveMetronomeIndicator() { state.indicatorMode = state.activeMetronomeMode; }
});
vm.runInContext(appFunction('toggleActiveMetronome'), state);
for (const mode of ['flexible', 'strict', 'off']) {
  state.toggleActiveMetronome();
  assert.equal(state.persistedMode, mode);
  assert.equal(state.indicatorMode, mode);
}

// M conserva su función incluso en revisión/edición; no interceptar la escritura.
let keydown;
state.window = { addEventListener(type, callback) { if (type === 'keydown') keydown = callback; } };
state.isEditableTarget = target => target === 'input';
state.editMode = true;
const start = app.indexOf("window.addEventListener('keydown'");
const end = app.indexOf('// Cualquier interacción', start);
vm.runInContext(app.slice(start, end), state);
const key = target => ({ key: 'm', target, preventDefault() {} });
await keydown(key('score'));
assert.equal(state.activeMetronomeMode, 'flexible');
await keydown(key('input'));
assert.equal(state.activeMetronomeMode, 'flexible');
assert.ok(!fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  .match(/id="active-metronome-mode"[^>]*\bdisabled\b/));
console.log('PASS limpieza de evaluación, STOP parado, render pendiente y modo de metrónomo global');
