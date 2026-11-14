import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const extract = name => {
  const start = app.indexOf(`function ${name}(`);
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const noop = () => {};
for (const mode of ['off', 'flexible', 'strict']) {
  let keydown;
  const score = { measures: 4, ppq: 480, events: [] };
  const state = {
    activeListening: true, activeListeningPaused: false, activeReferencePlayback: null,
    activeMetronomeMode: mode, activeStartingMeasure: 2, activeWaitingMeasure: 2,
    activeHasPerformed: false, activeMelodyStarted: false, activeFragmentConfirmed: false, activeCapturedEvents: [],
    activeRewindReadyMeasure: null, activeRewindLimitMeasure: null,
    activeInitialVisitedMeasures: new Set(), activeExpectedMeasure: null,
    activeRelocalizing: false, activeFollowAnchor: null, activeLastConfirmedHand: [],
    jsonScore: score, fromInput: { value: '2' }, toInput: { value: '4' },
    initializeActiveRecognizer(measure) {
      state.activeRecognizer = createMeasureRecognizer(score, { initialMeasure: measure });
    },
    measureStartTick: measure => (measure - 1) * 960,
    moveScoreCursor: tick => { state.lastCursorTick = tick; },
    syncMeasureInputBounds: noop, saveLessonPreference: noop, lessonFromControls: () => ({}),
    renderMeasureHighlights: noop, keepActiveCursorAboveHighlights: noop,
    isEditableTarget: target => Boolean(target?.editable),
    window: { addEventListener(type, callback) { if (type === 'keydown') keydown = callback; } }
  };
  vm.createContext(state);
  for (const name of ['shiftActiveStartingMeasure', 'canRewindActiveMeasure', 'rewindActiveMeasure']) {
    vm.runInContext(extract(name), state);
  }
  state.initializeActiveRecognizer(2);
  const start = app.indexOf("window.addEventListener('keydown'");
  vm.runInContext(app.slice(start, app.indexOf('// Cualquier interacción', start)), state);
  const checkbox = { editable: true, matches: () => true };
  const textInput = { editable: true, matches: () => false };
  const press = (key, target = checkbox) => keydown({ key, target, preventDefault() {} });
  await press('ArrowRight');
  assert.equal(state.activeStartingMeasure, 3, `${mode}: el foco del interruptor no bloquea la navegación inicial`);
  assert.equal(state.lastCursorTick, 1920);
  assert.equal(state.activeRecognizer.getProgress().expectedMeasure, 3);
  await press('ArrowLeft');
  assert.equal(state.activeStartingMeasure, 2);
  await press('ArrowRight', textInput);
  assert.equal(state.activeStartingMeasure, 2, 'los campos de texto/números conservan sus flechas');

  // Estado dejado por una referencia terminada antes del primer ataque.
  state.activeStartingMeasure = 1;
  state.activeWaitingMeasure = 2;
  state.activeRewindReadyMeasure = 2;
  state.activeRewindLimitMeasure = 2;
  state.initializeActiveRecognizer(2);
  await press('ArrowRight', { editable: false });
  assert.equal(state.activeStartingMeasure, 3, `${mode}: tras la referencia se elige libremente el inicio`);
  assert.equal(state.activeRewindReadyMeasure, null);
  assert.equal(state.activeRewindLimitMeasure, null);
  await press('ArrowRight'); await press('ArrowRight');
  assert.equal(state.activeStartingMeasure, 4);
  for (let i = 0; i < 5; i++) await press('ArrowLeft');
  assert.equal(state.activeStartingMeasure, 1);
  assert.equal(state.activeWaitingMeasure, 1);
  assert.equal(state.fromInput.value, '1');
}
console.log('PASS navegación inicial en los tres modos, foco del interruptor y vuelta de referencia');
