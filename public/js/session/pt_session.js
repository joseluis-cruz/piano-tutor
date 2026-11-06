import { PT_EVENT } from '../core/pt_events.js';

// ============================================================
// Parámetros de interpretación
// ============================================================
// Se expresan en relación con PPQ para que sean cantidades musicales y
// se adapten automáticamente al BPM elegido para la sesión.

// Duración de cada ataque rápido del mordente.
// 1/2 = corchea; 1/4 = semicorchea; 1/8 = fusa.
const MORDENT_NOTE_DURATION_IN_QUARTERS = 1 / 8;

// Solapamiento de una nota ligada de expresión sobre el ataque siguiente.
// 1/2 = corchea; 1/4 = semicorchea; 1/8 = fusa.
const LEGATO_OVERLAP_IN_QUARTERS = 1 / 4;

// Duración sonora máxima de una nota con staccato.
// No alarga nunca una nota cuya duración escrita sea menor.
// 1/2 = corchea; 1/4 = semicorchea; 1/8 = fusa.
const STACCATO_DURATION_IN_QUARTERS = 1 / 4;

// Incremento relativo de velocity para un acento. 1.20 = +20 %.
// El resultado se limita siempre al rango MIDI 1..127.
const ACCENT_VELOCITY_FACTOR = 1.20;

// Metrónomo General MIDI: canal de percusión y golpe Side Stick.
const METRONOME_CHANNEL = 9;
const METRONOME_PITCH = 37;
const METRONOME_ACCENT_VELOCITY = 105;
const METRONOME_BEAT_VELOCITY = 78;
const METRONOME_SOUND_DURATION_IN_QUARTERS = 1 / 8;

export const PT_HAND = Object.freeze({ NONE: 'none', RIGHT: 'right', LEFT: 'left', BOTH: 'both' });

function handMatches(event, hand) {
  if (hand === PT_HAND.NONE) return false;
  if (hand === PT_HAND.BOTH || hand == null) return true;
  // Convención canónica actual: staff/canal 0 = derecha; 1 = izquierda.
  return hand === PT_HAND.RIGHT ? event.channel === 0 : event.channel === 1;
}

function nextNoteInVoice(notes, index) {
  const current = notes[index];
  for (let i = index + 1; i < notes.length; i++) {
    const candidate = notes[i];
    if (candidate.channel === current.channel && candidate.voice === current.voice && candidate.startTick > current.startTick) return candidate;
  }
  return null;
}

function interpretedNote(score, notes, index) {
  const e = notes[index];
  const staccatoTicks = score.ppq * STACCATO_DURATION_IN_QUARTERS;
  const legatoOverlapTicks = score.ppq * LEGATO_OVERLAP_IN_QUARTERS;
  let endTick = e.endTick;
  const articulations = e.articulations ?? [];

  if (articulations.includes('staccato')) {
    endTick = Math.min(endTick, e.startTick + staccatoTicks);
  } else if (e.slur) {
    const next = nextNoteInVoice(notes, index);
    if (next && next.startTick <= e.endTick && next.pitch !== e.pitch) {
      endTick = Math.max(endTick, next.startTick + legatoOverlapTicks);
    }
  }

  let velocity = e.velocity ?? 80;
  if (articulations.includes('accent')) {
    velocity = Math.min(127, Math.max(1, Math.round(velocity * ACCENT_VELOCITY_FACTOR)));
  }
  return { source: e, endTick, velocity };
}

function plainNote({ startTick, endTick, pitch, velocity, sourceChannel, measure, sourceMeasureIndex, sourceNoteIndex }, originTick, msPerTick, channel = sourceChannel) {
  return {
    type: PT_EVENT.NOTE,
    startTick,
    endTick,
    timeOn: Math.max(0, (startTick - originTick) * msPerTick),
    timeOff: Math.max(0, (endTick - originTick) * msPerTick),
    channel,
    measure: Number.isFinite(measure) ? measure : undefined,
    sourceMeasureIndex, sourceNoteIndex,
    pitch,
    velocity
  };
}


/** Expansión musical compartida: una nota escrita puede generar varios ataques
 * MIDI esperados (mordente). Preserva las referencias a la nota original.
 * No incluye solapamientos expresivos de PlaybackSequence.
 */
export function expandExpectedNoteAttacks(note, ppq) {
  const mordent = note.ornaments?.find(o => o.type === 'mordent');
  const common = { measure:note.measure, staff:note.staff, channel:note.channel,
    sourceMeasureIndex:note.sourceMeasureIndex, sourceNoteIndex:note.sourceNoteIndex,
    sourceNote:note };
  if (!mordent) return [{...common,startTick:note.startTick,endTick:note.endTick,pitch:note.pitch,ornamentIndex:0}];
  const writtenTicks = Math.max(1,note.endTick-note.startTick);
  const d = Math.min(ppq*MORDENT_NOTE_DURATION_IN_QUARTERS,writtenTicks/3);
  return [
    {...common,startTick:note.startTick,endTick:note.startTick+d,pitch:note.pitch,ornamentIndex:0},
    {...common,startTick:note.startTick+d,endTick:note.startTick+2*d,pitch:mordent.alterPitch,ornamentIndex:1},
    {...common,startTick:note.startTick+2*d,endTick:note.endTick,pitch:note.pitch,ornamentIndex:2}
  ];
}

/**
 * Prepara una sesión a partir de la partitura canónica y la lección.
 * Genera simultáneamente:
 *  - playbackSequence: lo que debe sonar por MIDI OUT.
 *  - expectedPerformance: lo que esperamos que toque el alumno.
 *
 * options.playbackHand / options.evaluateHand permiten que ambas selecciones
 * sean independientes (p. ej. reproducir izquierda y evaluar derecha).
 */
export function createSession(score, lesson, options = {}) {
  if (!score?.events || !score.ppq) throw new Error('Partitura canónica no válida.');
  const fromMeasure = Number(lesson.fromMeasure);
  const toMeasure = Number(lesson.toMeasure);
  const bpm = Number(lesson.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('BPM no válido.');
  if (fromMeasure > toMeasure) throw new Error('El compás inicial no puede superar al final.');

  const startMarker = score.events.find(e => e.type === 'startOfMeasure' && e.measure === fromMeasure);
  if (!startMarker) throw new Error(`No se encuentra el compás inicial ${fromMeasure}.`);

  const originTick = startMarker.startTick;
  const msPerTick = 60000 / (bpm * score.ppq);
  const outputChannel = options.outputChannel ?? 0;
  const playbackHand = options.playbackHand ?? PT_HAND.BOTH;
  const evaluateHand = options.evaluateHand ?? PT_HAND.BOTH;
  const intro = Boolean(options.intro ?? lesson.intro);
  const metronome = Boolean(options.metronome ?? lesson.metronome);
  const beats = Number(startMarker.beats) || 4;
  const beatType = Number(startMarker.beatType) || 4;
  const beatTicks = score.ppq * 4 / beatType;
  const introTicks = intro ? beats * beatTicks : 0;
  const timelineOriginTick = originTick - introTicks;
  // ExpectedPerformance se referencia al inicio musical del pasaje, no a la intro.
  const expectedTimelineOriginTick = originTick;
  const mordentTicks = score.ppq * MORDENT_NOTE_DURATION_IN_QUARTERS;

  const notes = score.events
    .filter(e => e.type === 'note' && e.measure >= fromMeasure && e.measure <= toMeasure)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  const interpreted = notes.map((_, index) => interpretedNote(score, notes, index));
  const playbackSequence = [];
  const expectedEvents = [];

  // La intro siempre lleva metrónomo. El metrónomo continuo se añade durante
  // el pasaje sólo cuando la opción correspondiente está activada.
  const metronomeDurationTicks = score.ppq * METRONOME_SOUND_DURATION_IN_QUARTERS;
  const endMarker = score.events.find(e => e.type === 'startOfMeasure' && e.measure === toMeasure + 1);
  const selectedNotesEnd = Math.max(originTick, ...notes.map(e => e.endTick));
  const passageEndTick = endMarker?.startTick ?? selectedNotesEnd;
  const addMetronomeBeat = (tick, beatIndex) => {
    playbackSequence.push(plainNote({
      startTick: tick, endTick: tick + metronomeDurationTicks, pitch: METRONOME_PITCH,
      velocity: beatIndex === 0 ? METRONOME_ACCENT_VELOCITY : METRONOME_BEAT_VELOCITY,
      sourceChannel: METRONOME_CHANNEL
    }, timelineOriginTick, msPerTick, METRONOME_CHANNEL));
    playbackSequence.at(-1).type = PT_EVENT.METRONOME;
  };
  if (intro) for (let beat = 0; beat < beats; beat++) addMetronomeBeat(timelineOriginTick + beat * beatTicks, beat);
  if (metronome) {
    let beat = 0;
    for (let tick = originTick; tick < passageEndTick; tick += beatTicks) addMetronomeBeat(tick, beat++ % beats);
  }

  for (const item of interpreted) {
    const e = item.source;
    const mordent = e.ornaments?.find(o => o.type === 'mordent');

    if (handMatches(e, playbackHand)) {
      const base = plainNote({ startTick: e.startTick, endTick: item.endTick, pitch: e.pitch, velocity: item.velocity, sourceChannel: e.channel }, timelineOriginTick, msPerTick, outputChannel);
      if (mordent) {
        const writtenTicks = Math.max(1, item.endTick - e.startTick);
        const effectiveMordentTicks = Math.min(mordentTicks, writtenTicks / 3);
        playbackSequence.push({
          ...base,
          type: PT_EVENT.MORDENT,
          alterPitch: mordent.alterPitch,
          ornamentNoteDuration: effectiveMordentTicks * msPerTick
        });
      } else {
        playbackSequence.push(base);
      }
    }

    if (handMatches(e, evaluateHand)) {
      for (const attack of expandExpectedNoteAttacks(e, score.ppq)) {
        expectedEvents.push(plainNote({
          startTick:attack.startTick,endTick:attack.endTick,pitch:attack.pitch,
          velocity:item.velocity,sourceChannel:e.channel,measure:e.measure,
          sourceMeasureIndex:e.sourceMeasureIndex,sourceNoteIndex:e.sourceNoteIndex
        }, expectedTimelineOriginTick, msPerTick));
      }
    }
  }

  // Marcadores temporales sin salida MIDI. Permiten coordinar captura y UI incluso
  // cuando una práctica no tiene metrónomo ni acompañamiento audible.
  const passageStartTime = (originTick - timelineOriginTick) * msPerTick;
  const passageEndTime = Math.max(passageStartTime, (passageEndTick - timelineOriginTick) * msPerTick);
  playbackSequence.push({ type: PT_EVENT.PASSAGE_START, startTick: originTick, timeOn: passageStartTime, timeOff: passageStartTime });
  playbackSequence.push({ type: PT_EVENT.PASSAGE_END, startTick: passageEndTick, timeOn: passageEndTime, timeOff: passageEndTime });

  playbackSequence.sort((a, b) => a.timeOn - b.timeOn || (a.pitch ?? -1) - (b.pitch ?? -1));
  expectedEvents.sort((a, b) => a.timeOn - b.timeOn || a.pitch - b.pitch);

  return {
    config: { fromMeasure, toMeasure, bpm, ppq: score.ppq, originTick, timelineOriginTick, expectedTimelineOriginTick, intro, metronome, playbackHand, evaluateHand, beats, beatType, passageStartTime, passageEndTime },
    playbackSequence,
    expectedPerformance: {
      type: 'ExpectedPerformance',
      ppq: score.ppq,
      bpm,
      originTick,
      timelineOriginTick: expectedTimelineOriginTick,
      intro,
      fromMeasure,
      toMeasure,
      // Duración musical esperada del pasaje, incluidos silencios entre notas.
      // Sirve como denominador estable para métricas agregadas de timing.
      passageDuration: Math.max(0, (passageEndTick - originTick) * msPerTick),
      hand: evaluateHand,
      evaluation: {
        pitch: true,
        timing: metronome,
        duration: metronome && Boolean(lesson.evaluateDuration),
        dynamics: Boolean(lesson.evaluateDynamics)
      },
      events: expectedEvents
    }
  };
}
