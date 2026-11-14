import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PT_EVENT } from '../public/js/core/pt_events.js';
import { metronomeVoice } from '../public/js/core/pt_metronome.js';

const source = fs.readFileSync(new URL('../public/js/midi/pt_midi.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/\bexport /g, '');
for (const extendAt of [250, 501]) {
  let now = 0, serial = 0, ended = 0;
  const timers = new Map(), messages = [];
  const state = {
    PT_EVENT, metronomeVoice, performance: { now: () => now },
    setTimeout(callback, delay = 0) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), window: { addEventListener() {} },
    location: { origin: 'http://localhost' }, console: { log() {} },
    port: { contentWindow: { postMessage: message => messages.push({ time: now, data: Array.from(message.data) }) } }
  };
  vm.createContext(state);
  vm.runInContext(source + "\nframe=port; selectedOutputId='test';", state);
  function advance(target) {
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = target;
  }
  const note = (pitch, on) => ({ type: PT_EVENT.NOTE, pitch, channel: 0, timeOn: on, timeOff: on + 100 });
  const end = time => ({ type: PT_EVENT.PASSAGE_END, timeOn: time, timeOff: time });
  state.play([note(60, 0), end(500)], { onEnd: () => { ended++; } });
  advance(extendAt);
  assert.equal(state.appendPlaybackEvents([note(64, 500), end(1000)]), true);
  assert.equal(state.appendPlaybackEvents([note(67, 1000), end(1500)]), true);
  advance(1000);
  assert.equal(ended, 0, 'la ampliación cancela el final anteriormente programado');
  advance(1510);
  assert.equal(ended, 1);
  assert.deepEqual(messages.filter(message => message.data[0] === 0x90).map(message => message.data[1]), [60, 64, 67]);
  assert.equal(state.appendPlaybackEvents([note(69, 1600)]), false, 'no se amplía una reproducción finalizada');
}
console.log('PASS reproducción ampliable sin reinicios ni ataques duplicados, incluso al borde del final');
