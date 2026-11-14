export let debugEnabled = new URLSearchParams(globalThis.location?.search ?? '').get('debug') === 'true';

export function setDebugEnabled(enabled) {
  debugEnabled = Boolean(enabled);
}

// Consola local de la aplicación; no modifica la consola global ni la de OSMD.
export const debugConsole = Object.fromEntries(
  ['log', 'info', 'debug', 'warn', 'error'].map(level => [level, (...args) => {
    if (debugEnabled) globalThis.console[level](...args);
  }])
);
