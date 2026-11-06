import { pitchToMidi } from './Pitch.js';

const STEP_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

function keyAlterations(fifths) {
  const result = Object.fromEntries(STEP_ORDER.map(step => [step, 0]));
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const alter = fifths >= 0 ? 1 : -1;
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++) result[order[i]] = alter;
  return result;
}

function adjacentDiatonicPitch(step, octave, direction, keyAlters, accidentalAlter = null) {
  const index = STEP_ORDER.indexOf(step);
  let nextIndex = index + direction;
  let nextOctave = octave;
  if (nextIndex < 0) { nextIndex = 6; nextOctave--; }
  if (nextIndex > 6) { nextIndex = 0; nextOctave++; }
  const nextStep = STEP_ORDER[nextIndex];
  const alter = accidentalAlter ?? keyAlters[nextStep] ?? 0;
  return pitchToMidi(nextStep, alter, nextOctave);
}

function accidentalTextToAlter(text) {
  const values = { flat: -1, natural: 0, sharp: 1, 'double-flat': -2, 'flat-flat': -2, 'double-sharp': 2, 'sharp-sharp': 2 };
  return Object.prototype.hasOwnProperty.call(values, text) ? values[text] : null;
}

function mergeTies(events) {
  const result = [];
  const open = new Map();
  for (const event of events) {
    if (event.type !== 'note') { result.push(event); continue; }
    const key = `${event.channel}:${event.voice}:${event.pitch}`;
    const previous = open.get(key);
    if (event.tieStop && previous) {
      previous.endTick = Math.max(previous.endTick, event.endTick);
      previous.tie = true;
      previous.articulations = [...new Set([...(previous.articulations ?? []), ...(event.articulations ?? [])])];
      previous.slur = previous.slur || event.slur;
      if (event.ornaments?.length) previous.ornaments = [...(previous.ornaments ?? []), ...event.ornaments];
      if (event.tieStart) open.set(key, previous); else open.delete(key);
      continue;
    }
    const clean = { ...event };
    delete clean.tieStart; delete clean.tieStop;
    result.push(clean);
    if (event.tieStart) open.set(key, clean);
  }
  return result;
}

export class MusicXMLParser {
  constructor(ppq = 480) { this.ppq = ppq; }

  parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('MusicXML no válido.');
    const part = doc.querySelector('score-partwise > part');
    if (!part) throw new Error('No se encontró una parte MusicXML score-partwise.');

    let divisions = 1;
    let absoluteTick = 0;
    let fifths = 0;
    let beats = 4;
    let beatType = 4;
    let keyAlters = keyAlterations(fifths);
    const events = [];
    const warnings = [];
    const measures = [...part.querySelectorAll(':scope > measure')];
    const activeSlurs = new Map();

    for (const [index, measure] of measures.entries()) {
      const measureNumber = Number.parseInt(measure.getAttribute('number'), 10) || index + 1;
      const divNode = measure.querySelector(':scope > attributes > divisions');
      if (divNode) divisions = Number(divNode.textContent) || divisions;
      const beatsNode = measure.querySelector(':scope > attributes > time > beats');
      const beatTypeNode = measure.querySelector(':scope > attributes > time > beat-type');
      if (beatsNode) beats = Number(beatsNode.textContent) || beats;
      if (beatTypeNode) beatType = Number(beatTypeNode.textContent) || beatType;
      const fifthsNode = measure.querySelector(':scope > attributes > key > fifths');
      if (fifthsNode) { fifths = Number(fifthsNode.textContent) || 0; keyAlters = keyAlterations(fifths); }

      const measureStart = absoluteTick;
      events.push({ type: 'startOfMeasure', measure: measureNumber, startTick: measureStart, beats, beatType });
      let cursor = measureStart;
      let maxTick = measureStart;
      let previousNoteStart = cursor;
      let sourceNoteIndex = 0;

      for (const node of [...measure.children]) {
        const durationDiv = Number(node.querySelector(':scope > duration')?.textContent || 0);
        const durationTicks = Math.round(durationDiv * this.ppq / divisions);
        if (node.tagName === 'backup') { cursor -= durationTicks; continue; }
        if (node.tagName === 'forward') { cursor += durationTicks; maxTick = Math.max(maxTick, cursor); continue; }
        if (node.tagName !== 'note') continue;
        const currentSourceNoteIndex = sourceNoteIndex++;

        const isChord = !!node.querySelector(':scope > chord');
        const isRest = !!node.querySelector(':scope > rest');
        const noteStart = isChord ? previousNoteStart : cursor;
        if (!isChord) previousNoteStart = noteStart;

        if (!isRest) {
          const pitch = node.querySelector(':scope > pitch');
          if (pitch) {
            const step = pitch.querySelector(':scope > step')?.textContent;
            const alter = Number(pitch.querySelector(':scope > alter')?.textContent || 0);
            const octave = Number(pitch.querySelector(':scope > octave')?.textContent);
            const staff = Number(node.querySelector(':scope > staff')?.textContent || 1);
            const voice = node.querySelector(':scope > voice')?.textContent?.trim() || '1';
            const channel = Math.max(0, staff - 1);
            const slurKey = `${channel}:${voice}`;
            const slurs = [...node.querySelectorAll(':scope > notations > slur')];
            const starts = slurs.filter(s => s.getAttribute('type') === 'start').map(s => s.getAttribute('number') || '1');
            const stops = slurs.filter(s => s.getAttribute('type') === 'stop').map(s => s.getAttribute('number') || '1');
            const active = activeSlurs.get(slurKey) ?? new Set();
            for (const n of starts) active.add(n);

            const articulations = [];
            if (node.querySelector(':scope > notations > articulations > staccato')) articulations.push('staccato');
            if (node.querySelector(':scope > notations > articulations > accent')) articulations.push('accent');

            const ornaments = [];
            const mordentNode = node.querySelector(':scope > notations > ornaments > mordent');
            const invertedMordentNode = node.querySelector(':scope > notations > ornaments > inverted-mordent');
            if (mordentNode || invertedMordentNode) {
              // MusicXML: mordent = lower auxiliary; inverted-mordent = upper auxiliary.
              const direction = invertedMordentNode ? 1 : -1;
              const accidentalMark = node.querySelector(':scope > notations > ornaments > accidental-mark');
              const accidentalAlter = accidentalMark ? accidentalTextToAlter(accidentalMark.textContent.trim()) : null;
              ornaments.push({
                type: 'mordent',
                alterPitch: adjacentDiatonicPitch(step, octave, direction, keyAlters, accidentalAlter)
              });
            }

            const tieTypes = [...node.querySelectorAll(':scope > tie')].map(t => t.getAttribute('type'));
            const fingerings = [...node.querySelectorAll(':scope > notations > technical > fingering')]
              .map(f => f.textContent?.trim()).filter(v => /^[1-5]$/.test(v ?? '')).map(Number);
            const fingering = fingerings[0] ?? null;
            const mordentKind = invertedMordentNode ? 'inverted' : (mordentNode ? 'mordent' : null);
            const event = {
              type: 'note', measure: measureNumber, staff, sourceMeasureIndex: index, sourceNoteIndex: currentSourceNoteIndex,
              startTick: noteStart, endTick: noteStart + durationTicks,
              channel, voice, pitch: pitchToMidi(step, alter, octave), velocity: 80, fingering, fingerings, mordentKind
            };
            if (articulations.length) event.articulations = articulations;
            if (ornaments.length) event.ornaments = ornaments;
            if (active.size > 0) event.slur = true;
            if (tieTypes.includes('start')) event.tieStart = true;
            if (tieTypes.includes('stop')) event.tieStop = true;
            events.push(event);

            for (const n of stops) active.delete(n);
            if (active.size) activeSlurs.set(slurKey, active); else activeSlurs.delete(slurKey);
          }
        }
        if (!isChord) cursor += durationTicks;
        maxTick = Math.max(maxTick, noteStart + durationTicks, cursor);
      }
      absoluteTick = maxTick;
    }

    const merged = mergeTies(events);
    merged.sort((a, b) => a.startTick - b.startTick || (a.type === 'startOfMeasure' ? -1 : 1));
    return { ppq: this.ppq, measures: measures.length, events: merged, warnings };
  }
}
