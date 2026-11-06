// Preferencia común a los ticks de sesión y a los de Escucha activa.
let useDrumKit = false;

export function setMetronomeDrumKit(enabled) {
  useDrumKit = Boolean(enabled);
}

export function metronomeVoice(pianoPitch = 96) {
  // Canales MIDI internos: 0 = canal 1, 9 = canal 10 (percusión).
  return useDrumKit ? { channel: 9, pitch: 37 } : { channel: 0, pitch: pianoPitch };
}
