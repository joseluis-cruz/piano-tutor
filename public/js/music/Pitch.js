const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function pitchToMidi(step, alter = 0, octave) {
  return 12 * (Number(octave) + 1) + STEP[step] + Number(alter || 0);
}
