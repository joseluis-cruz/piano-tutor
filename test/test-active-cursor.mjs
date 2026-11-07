import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';

// Ejecutar los callbacks reales de la aplicación, sustituyendo solo UI y MIDI.
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
function appFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}
const noop = () => {};
const notes = [
  { pitch: 72, startTick: 0, endTick: 240, measure: 1, channel: 0 },
  { pitch: 74, startTick: 480, endTick: 960, measure: 1, channel: 0 },
  { pitch: 76, startTick: 1920, endTick: 2160, measure: 2, channel: 0 },
  { pitch: 77, startTick: 2400, endTick: 2880, measure: 2, channel: 0 }
];
const moves = [], backgrounds = [];
const state = {
  activeListening: true, activeListeningPaused: false, activeRelocalizing: false,
  activeStartingMeasure: 1, activeWaitingMeasure: 1, activeExpectedMeasure: null,
  activeFollowAnchor: null, activeFollowBpm: null, activeLastStudentOn: null,
  lastCursorTick: null, activeLastMusicalAttackTime: null,
  activeMelodyStarted: false, activeFirstMelodyTime: null, activeFirstMelodyTick: null,
  activeFragmentStartTime: null, activeFragmentFirstMeasure: null, activeFragmentLastMeasure: null,
  activeFragmentConfirmed: false, activeFragmentHands: new Set(), activeFragmentAnchors: [],
  activeCapturedEvents: [], activeRecognizedTick: null, activeMeasuredBpm: null,
  activeLastConfirmedHand: [], activeSessionMetronomeMode: 'off', activeMetronomeMode: 'off',
  activeStrictTempoLocked: false, activeListeningTempo: null, activeRemainingToTick: null,
  showEvaluationMeasureBackgrounds: false, lessonDirty: false, lesson: { bpm: 120 },
  jsonScore: { measures: 2, ppq: 480, events: notes },
  bpmInput: { value: '120' }, fromInput: { value: '1' }, toInput: { value: '2' },
  recordRightInput: {}, recordLeftInput: {}, osmd: null,
  performance: { now: () => 10000 }, console: { log: noop },
  requestAnimationFrame: callback => callback(), activeLog: noop,
  clearActiveFlexStop: noop, scheduleFlexibleStopAfterCurrentMeasure: noop,
  updateActiveMetronomeIndicator: noop, syncMeasureInputBounds: noop,
  updateAccompanyControls: noop, saveLessonPreference: noop, lessonFromControls: () => ({}),
  showActiveListeningStatus: noop, activeMeterRunning: () => false, clearActiveTick: noop,
  measureStartTick: measure => (measure - 1) * 1920,
  moveScoreCursor: tick => moves.push(tick),
  renderMeasureHighlights: () => backgrounds.push(state.activeWaitingMeasure)
};
vm.createContext(state);
for (const name of ['activeRecognitionProgress', 'activeRecognizedMeasure',
  'startActiveRelocalization', 'toggleActiveListeningPause']) {
  vm.runInContext(appFunction(name), state);
}
state.activeRecognizer = createMeasureRecognizer(state.jsonScore, {
  fullExpectedPerformance: { events: notes },
  onProgress: state.activeRecognitionProgress,
  onRecognized: state.activeRecognizedMeasure
});
const feed = (pitch, time) => state.activeRecognizer.feed({ pitch, time, velocity: 80 });

feed(72, 1000);
assert.equal(moves.at(-1), 0);
feed(74, 1500);
assert.equal(state.activeRecognizer.getProgress().lastConfirmed, 1);
assert.equal(state.activeWaitingMeasure, 2);
assert.equal(backgrounds.at(-1), 2);
assert.equal(moves.at(-1), 480, 'confirmar el compás conserva su último ataque');

let count = moves.length;
state.startActiveRelocalization(10000, 'Silencio');
assert.equal(backgrounds.at(-1), 2);
assert.equal(moves.length, count, 'la espera automática no adelanta el cursor');
state.startActiveRelocalization(11000, 'Silencio repetido');
assert.equal(moves.length, count);

state.toggleActiveListeningPause();
assert.equal(state.activeListeningPaused, true);
assert.equal(moves.length, count, 'la pausa manual conserva el último ataque');
state.toggleActiveListeningPause();
assert.equal(state.activeListeningPaused, false);
assert.equal(moves.length, count, 'reanudar sin tocar tampoco mueve el cursor');

feed(76, 12000);
assert.equal(moves.at(-1), 1920, 'la primera nota del siguiente compás avanza el cursor');
feed(77, 12500);
assert.equal(state.activeWaitingMeasure, null);
assert.equal(moves.at(-1), 2400, 'el final de la pieza conserva su último ataque');
count = moves.length;
state.startActiveRelocalization(20000, 'Final');
assert.equal(moves.length, count, 'el silencio final no cambia la posición');

// OSMD 1.9.7 show() restaura zIndex=-1 después de actualizar la imagen.
// La capa del cursor debe elevarse DESPUÉS de esa llamada, también en el RAF.
class Element {
  style = {};
  closest() { return null; }
}
const cursorElement = new Element();
cursorElement.style.left = '200px';
state.HTMLElement = Element;
state.SVGElement = class {};
state.$ = () => ({ querySelectorAll: () => [cursorElement] });
state.osmd = { cursor: {
  cursorElement,
  show() { cursorElement.style.zIndex = '-1'; cursorElement.style.display = ''; }
} };
state.setCursorAppearance = noop;
vm.runInContext(appFunction('keepActiveCursorAboveHighlights'), state);
state.keepActiveCursorAboveHighlights();
assert.equal(cursorElement.style.zIndex, '30', 'show() no debe dejar el cursor detrás del fondo');
assert.equal(cursorElement.style.left, '200px', 'elevar el cursor no cambia su posición');
state.activeRecognitionProgress({ provisionalTick: 2400, provisionalTime: 12500, expectedMeasure: 2 });
assert.equal(cursorElement.style.zIndex, '30', 'la actualización diferida también conserva la capa visible');

console.log('PASS cursor de escucha activa: fin de compás, espera, pausa, reanudación y fin de pieza');

// Captura real y borrado: conservar compases anteriores, repetir y retroceder.
Object.assign(state, {
  osmd: null, activeRecognizer: null, activeCapturedEvents: [],
  activeCaptureOpenNotes: new Map(), activeHeldKeys: new Set(), activeRewindReadyMeasure: null, activeRewindLimitMeasure: null,
  activeStartingMeasure: 1, activeFragmentConfirmed: false, activeFragmentAnchors: [],
  activeFragmentHands: new Set(), activeMelodyStarted: false, activeListeningPaused: false,
  activeFragmentStartTime: null, activeFragmentFirstMeasure: null, activeFragmentLastMeasure: null,
  ACTIVE_TAP_MIN_PITCH: 96, pitchName: String, keepActiveCursorAboveHighlights: noop,
  moveScoreCursor: tick => { state.lastCursorTick = tick; },
  jsonScore: { measures: 3, ppq: 480, events: [...notes,
    { pitch: 79, startTick: 3840, endTick: 4080, measure: 3, channel: 0 },
    { pitch: 81, startTick: 4320, endTick: 4560, measure: 3, channel: 0 }
  ] }
});
for (const name of ['activeMidiInput', 'canRewindActiveMeasure', 'rewindActiveMeasure']) vm.runInContext(appFunction(name), state);
const diagnostics = [];
state.activeRecognizer = createMeasureRecognizer(state.jsonScore, {
  fullExpectedPerformance: { events: state.jsonScore.events },
  onProgress: state.activeRecognitionProgress, onRecognized: state.activeRecognizedMeasure,
  onDebug: (message, data) => diagnostics.push({ message, data })
});
const on = (pitch, time) => state.activeMidiInput([0x90, pitch, 80], time);
const off = (pitch, time) => state.activeMidiInput([0x80, pitch, 0], time);
on(72, 1000); off(72, 1100); on(74, 1500); off(74, 1600);
on(76, 2000); off(76, 2100); on(77, 2500); off(77, 2600);
on(50, 3000); // Nota no reconocida en el compás 3, todavía pulsada.
assert.equal(state.activeRecognizer.getProgress().expectedMeasure, 3);
assert.equal(state.activeCapturedEvents.length, 9);
assert.equal(state.rewindActiveMeasure(), true);
assert.equal(state.lastCursorTick, 3840);
assert.equal(state.activeCapturedEvents.length, 8);
assert.equal(state.activeFragmentLastMeasure, 2);
off(50, 3100);
assert.equal(state.activeCapturedEvents.length, 8, 'soltar una nota borrada no contamina la captura');

state.rewindActiveMeasure();
assert.equal(state.lastCursorTick, 1920);
assert.equal(state.activeCapturedEvents.length, 4);
assert.equal(state.activeFragmentLastMeasure, 1);
assert.equal(state.activeRecognizer.getConfirmedMeasures().length, 1);
assert.ok(state.activeFragmentAnchors.every(anchor => anchor.measure === 1));

on(76, 4000); // Volver a tocar invalida la segunda pulsación de retroceso.
assert.equal(state.activeRewindReadyMeasure, null);
state.rewindActiveMeasure();
assert.equal(state.lastCursorTick, 1920, 'tras tocar se reinicia el mismo compás');
assert.equal(state.activeCapturedEvents.length, 4);
on(76, 5000); off(76, 5100); on(77, 5500); off(77, 5600);
assert.equal(state.activeFragmentLastMeasure, 2, 'se puede confirmar otra vez el compás borrado');
assert.equal(state.activeCapturedEvents.length, 8);

state.rewindActiveMeasure(); // Limpiar el pendiente 3.
state.rewindActiveMeasure(); // Borrar el 2.
state.rewindActiveMeasure(); // Borrar el 1.
assert.equal(state.lastCursorTick, 0);
assert.equal(state.activeCapturedEvents.length, 0);
assert.equal(state.activeFragmentAnchors.length, 0);
assert.equal(state.activeFragmentConfirmed, false);
assert.equal(state.activeFragmentStartTime, null);
state.rewindActiveMeasure();
assert.equal(state.lastCursorTick, 0, 'el retroceso se detiene en el primer compás');
state.activeMetronomeMode = 'strict';
assert.equal(state.rewindActiveMeasure(), false, 'el borrado solo está activo sin metrónomo');
state.activeMetronomeMode = 'off'; state.activeListeningPaused = true;
assert.equal(state.rewindActiveMeasure(), false);
state.activeListeningPaused = false;
state.activeMetronomeMode = 'flexible'; state.activeFlexSuspended = false;
let cancelledTicks = 0, cancelledStops = 0;
state.clearActiveTick = () => { cancelledTicks++; };
state.clearActiveFlexStop = () => { cancelledStops++; };
state.activeListeningTempo = { pitch: 96, periodMs: 500 };
state.activeFlexMeasureGuard = { measure: 3 };
state.activeRewindReadyMeasure = null; state.activeRewindLimitMeasure = null;
state.activeRecognizer.rewind(3);
assert.equal(state.rewindActiveMeasure(), true, 'se reinicia incluso con el flexible sonando');
assert.equal(cancelledTicks, 1, 'se cancelan los ticks pendientes');
assert.equal(cancelledStops, 1, 'se cancela la suspensión automática anterior');
assert.equal(state.activeFlexSuspended, true);
assert.equal(state.activeListeningTempo, null);
assert.equal(state.activeFlexMeasureGuard, null);
assert.equal(state.lastCursorTick, 3840);
state.rewindActiveMeasure();
assert.equal(state.lastCursorTick, 1920, 'izquierda retrocede al compás anterior');
state.rewindActiveMeasure(1);
assert.equal(state.lastCursorTick, 3840, 'derecha vuelve a avanzar por los compases borrados');
state.rewindActiveMeasure(1);
assert.equal(state.lastCursorTick, 3840, 'derecha no salta más allá del compás donde se detuvo');
assert.equal(state.activeFlexSuspended, true);
assert.equal(state.activeListeningTempo, null);
on(79, 30000);
assert.equal(state.activeRewindLimitMeasure, null, 'tocar inicia un nuevo intento y termina la navegación');
let keydown;
state.window = { addEventListener(type, callback) { if(type === 'keydown') keydown = callback; } };
state.isEditableTarget = () => false;
const handlerStart = app.indexOf("window.addEventListener('keydown'");
const handlerEnd = app.indexOf('// Cualquier interacción', handlerStart);
vm.runInContext(app.slice(handlerStart, handlerEnd), state);
const press = key => keydown({ key, preventDefault() {} });
state.activeFlexSuspended = false;
await press('ArrowLeft');
assert.equal(state.activeRewindReadyMeasure, 3, 'la flecha silencia y reinicia con flexible sonando');
assert.equal(state.activeFlexSuspended, true);
await press('ArrowLeft');
assert.equal(state.lastCursorTick, 1920);
state.activeFlexSuspended = false;
await press('ArrowRight');
assert.equal(state.lastCursorTick, 3840);
assert.equal(state.activeFlexSuspended, true, 'derecha también fuerza el silencio antes de avanzar');

let scheduled = 0;
Object.assign(state, { ACTIVE_FLEX_CONFIDENCE: .76, activeLastTickPitch: 96,
  updateFlexMeasureGuard: noop, scheduleActiveTick: () => { scheduled++; } });
on(79, 31000); on(81, 31500);
assert.equal(state.activeFlexSuspended, false, 'el metrónomo se reactiva al reconocer el nuevo intento');
assert.ok(scheduled > 0);
assert.ok(diagnostics.some(entry => entry.message === 'Estado del intento'));
assert.ok(diagnostics.some(entry => entry.message === 'Compás borrado y reconocedor rearmado'));
state.activeRecognizer.reset();
console.log('PASS borrado de escucha activa: captura, NoteOff, anclas, repetición y retroceso');
