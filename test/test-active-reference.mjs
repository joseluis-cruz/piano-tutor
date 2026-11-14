import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createSession, PT_HAND } from '../public/js/session/pt_session.js';
import { createMeasureRecognizer } from '../public/js/session/pt_recognizer.js';
import { PT_EVENT } from '../public/js/core/pt_events.js';

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const noop = () => {};
for (const mode of ['off', 'flexible', 'strict']) {
  const score = { ppq: 480, measures: 4, events: [] };
  for (let measure = 1; measure <= 4; measure++) {
    const startTick = (measure - 1) * 960;
    score.events.push({ type: 'startOfMeasure', measure, startTick, beats: 2, beatType: 4 });
    for (let i = 0; i < 2; i++) score.events.push({ type: 'note', measure, startTick: startTick + i * 480,
      endTick: startTick + (i + 1) * 480, channel: 0, staff: 1, pitch: 60 + measure * 2 + i });
  }
  const rec = createMeasureRecognizer(score, { fullExpectedPerformance: { events: score.events.filter(e => e.type === 'note') } });
  for (const note of score.events.filter(e => e.type === 'note' && e.measure <= 2)) {
    rec.feed({ pitch: note.pitch, velocity: 80, time: 1000 + note.startTick });
  }
  assert.equal(rec.getProgress().expectedMeasure, 3);
  const playback = [], alerts = [];
  let stopped = 0, tickClears = 0, keydown;
  const state = {
    activeListening: true, activeListeningPaused: false, activeReferencePlayback: null,
    activeRecognizer: rec, jsonScore: score, activeMetronomeMode: mode,
    lastCursorTick: 1440, activeStartingMeasure: 1, activeWaitingMeasure: 3,
    activeMeasuredBpm: 120, activeFollowBpm: 120,
    activeCapturedEvents: [1, 2, 3].flatMap(measure => [
      { type: 'noteOn', measure, pitch: 60, channel: 0, time: 1000 * measure },
      { type: 'noteOff', measure, pitch: 60, channel: 0, time: 1000 * measure + 100 }
    ]), activeCaptureOpenNotes: new Map(), activeHeldKeys: new Set(),
    activeFragmentAnchors: [1, 2].map(measure => ({ measure, tick: (measure - 1) * 960, time: 1000 * measure, bpm: 120 })),
    activeFragmentHands: new Set(['right']), activeFragmentConfirmed: true,
    activeHasPerformed: true, activeMelodyStarted: true, activeFragmentFirstMeasure: 1, activeFragmentLastMeasure: 2,
    activeRewindReadyMeasure: null, activeRewindLimitMeasure: null,
    activeFragmentStartTime: 1000, activeFollowAnchor: {}, activeRelocalizing: false,
    activeRecognizedTick: 1440, activeLastStudentOn: 3000, activeLastMusicalAttackTime: 3000,
    activeLastConfirmedHand: ['right'], showEvaluationMeasureBackgrounds: false,
    activeFlexSuspended: false, activeFlexMeasureGuard: {}, activeListeningTempo: { periodMs: 500 },
    activeStrictTempoLocked: true, activeStrictTempoFromTap: true, activeRemainingToTick: 100,
    fromInput: { value: '1' }, bpmInput: { value: '90' },
    PT_EVENT, PT_HAND, PT_PLAYBACK_STATE: { PLAYING: 'PLAYING', STOPPED: 'STOPPED' },
    createSession, performance: { now: () => 10000 }, console: { log() {}, error() {} },
    lessonFromControls: () => ({ bpm: 90, fromMeasure: 1, toMeasure: 4, intro: true, metronome: true }),
    measureStartTick: measure => (measure - 1) * 960,
    measurePositionAtTick: tick => ({ measure: Math.floor(tick / 960) + 1 }),
    moveScoreCursor: tick => { state.lastCursorTick = tick; },
    clearActiveFlexStop: noop, clearActiveTick: () => { tickClears++; }, clearActiveTap: noop,
    syncMeasureInputBounds: noop, saveLessonPreference: noop, renderMeasureHighlights: noop,
    keepActiveCursorAboveHighlights: noop, showActiveListeningStatus: noop, updateMidiControls: noop,
    setPlaybackState: value => { state.playbackState = value; },
    setTransportStatus: (kind, text) => { state.statusText = text; },
    stop: () => { stopped++; }, play: (events, callbacks) => playback.push({ events, callbacks }),
    appendPlaybackEvents: events => { playback.at(-1).events.push(...events); return true; },
    ACTIVE_TAP_MIN_PITCH: 96, activeLog: noop, pitchName: String,
    alert: message => alerts.push(message), leaveEditMode: noop, isEditableTarget: () => false,
    deactivateActiveListening: async () => { state.activeListening = false; },
    window: { addEventListener(type, callback) { if (type === 'keydown') keydown = callback; } }
  };
  vm.createContext(state);
  for (const name of ['resetActiveMeasure', 'activeReferenceSequence', 'updateActiveReferenceStatus', 'finishActiveReferencePlayback',
    'startOrExtendActiveReferencePlayback', 'activeMidiInput']) vm.runInContext(extract(name), state);
  const start = app.indexOf("window.addEventListener('keydown'");
  vm.runInContext(app.slice(start, app.indexOf('// Cualquier interacción', start)), state);
  const space = repeat => keydown({ key: ' ', code: 'Space', repeat, preventDefault() {} });
  await space();
  assert.equal(state.statusText, 'Escuchando 1 compás');
  assert.equal(state.activeReferencePlayback.startMeasure, 2, 'se usa el compás del cursor, no el pendiente 3');
  assert.equal(state.activeListeningPaused, true);
  assert.equal(state.activeCapturedEvents.length, 2, 'se conserva solo la captura anterior al compás 2');
  assert.equal(state.activeFragmentLastMeasure, 1);
  assert.equal(rec.getProgress().expectedMeasure, 2);
  assert.ok(tickClears > 0);
  assert.equal(state.activeListeningTempo, null);
  assert.equal(playback.length, 1);
  await space(true);
  assert.equal(state.activeReferencePlayback.endMeasure, 2, 'mantener Espacio no encadena compases');
  await space(); await space(); await space();
  assert.equal(state.statusText, 'Escuchando 3 compases');
  assert.equal(state.activeReferencePlayback.endMeasure, 4, 'la cola no rebasa el movimiento');
  assert.equal(playback.length, 1, 'añadir compases no reinicia la reproducción');
  const sequence = playback[0].events;
  assert.equal(sequence.filter(e => e.type === PT_EVENT.METRONOME).length, 0);
  assert.equal(sequence.filter(e => e.type === PT_EVENT.PASSAGE_START).length, 3);
  assert.deepEqual(sequence.filter(e => e.type === PT_EVENT.NOTE).map(e => Math.round(e.timeOn)), [0, 500, 1000, 1500, 2000, 2500]);
  state.activeMidiInput([0x90, 64, 80], 12000);
  state.activeMidiInput([0x80, 64, 0], 12100);
  assert.equal(state.activeCapturedEvents.length, 2, 'no se graba MIDI durante la referencia');
  const callbacks = playback[0].callbacks;
  callbacks.onEvent(sequence.find(e => e.type === PT_EVENT.PASSAGE_END && e.referenceMeasure === 2));
  assert.equal(state.statusText, 'Escuchando 2 compases');
  callbacks.onEvent(sequence.find(e => e.type === PT_EVENT.PASSAGE_START && e.referenceMeasure === 3));
  assert.equal(state.statusText, 'Escuchando 2 compases');
  callbacks.onEvent(sequence.find(e => e.type === PT_EVENT.PASSAGE_START && e.startTick === 2880));
  assert.equal(state.lastCursorTick, 2880);
  assert.equal(state.statusText, 'Escuchando 1 compás');
  callbacks.onEvent(sequence.find(e => e.type === PT_EVENT.PASSAGE_END && e.referenceMeasure === 4));
  assert.equal(state.statusText, 'Escuchando 0 compases');
  callbacks.onEnd();
  assert.equal(state.lastCursorTick, 960, 'al terminar vuelve al compás original');
  assert.equal(state.activeListening, true);
  assert.equal(state.activeListeningPaused, false);
  assert.equal(state.activeReferencePlayback, null);
  assert.equal(rec.getProgress().expectedMeasure, 2);
  assert.equal(state.activeCapturedEvents.length, 2);

  await space(); await space();
  await keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(state.activeListening, true, 'ESC cancela la referencia y mantiene la Escucha activa');
  assert.equal(state.activeListeningPaused, false);
  assert.equal(state.activeReferencePlayback, null);
  assert.equal(state.lastCursorTick, 960);
  callbacks.onEnd(); // Un callback antiguo no puede cerrar otra reproducción.
  await space();
  callbacks.onEnd();
  assert.ok(state.activeReferencePlayback);
  state.finishActiveReferencePlayback();
  assert.ok(stopped >= 3);
  assert.equal(alerts.length, 0);
  // Un fallo de MIDI no deja suspendida la captura ni una cola fantasma.
  state.activeCapturedEvents = [{ type: 'noteOn', measure: 1, pitch: 62, channel: 0, time: 1000 }];
  state.activeCaptureOpenNotes.set('0:62', state.activeCapturedEvents[0]);
  state.play = () => { throw new Error('Salida MIDI desconectada'); };
  await space();
  assert.equal(state.activeReferencePlayback, null);
  assert.equal(state.activeListeningPaused, false);
  assert.equal(state.activeListening, true);
  assert.equal(state.lastCursorTick, 960);
  assert.equal(alerts.length, 1);
  assert.equal(state.activeCapturedEvents.at(-1).type, 'noteOff', 'se cierran las notas conservadas antes de suspender la captura');
  assert.equal(state.activeCapturedEvents.at(-1).measure, 1);
  rec.reset();
}
console.log('PASS referencia activa: compás del cursor, cola, captura, final, ESC y los tres modos de metrónomo');
