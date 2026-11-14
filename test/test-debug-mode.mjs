import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/core/pt_debug.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '') + '\nthis.enabled = debugEnabled; this.logger = debugConsole; this.setEnabled = setDebugEnabled;';
for (const search of ['', '?debug=false', '?debug=1', '?debug=True', '?debug=true', '?piece=bach&debug=true']) {
  const calls = [];
  const originalConsole = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error']
    .map(level => [level, (...args) => calls.push([level, ...args])]));
  const state = { location: { search }, URLSearchParams, console: originalConsole };
  vm.runInNewContext(source, state);
  const expected = new URLSearchParams(search).get('debug') === 'true';
  assert.equal(state.enabled, expected);
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) state.logger[level]('mensaje', { detail: 1 });
  assert.equal(calls.length, expected ? 5 : 0, search);
  assert.equal(state.console, originalConsole, 'la consola global permanece intacta');
  if (expected) assert.deepEqual(calls[0], ['log', 'mensaje', { detail: 1 }]);
  calls.length = 0;
  state.setEnabled(true);
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) state.logger[level]('activado sin recargar');
  assert.equal(calls.length, 5, 'activar en ejecución habilita todos los niveles');
  state.setEnabled(false);
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) state.logger[level]('desactivado');
  assert.equal(calls.length, 5, 'desactivar vuelve a silenciar todos los niveles');
}
console.log('PASS consola: estado inicial por URL y activación/desactivación en ejecución');

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf('\n}', start);
  return app.slice(start, end + 2);
};
const classList = () => {
  const values = new Set();
  return { contains: name => values.has(name), toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); } };
};
for (const debugEnabled of [false, true]) {
  const asideViews = Object.fromEntries(['repertoire', 'lesson', 'results', 'settings', 'developer']
    .map(name => [name, { hidden: true }]));
  const asideButtons = ['repertoire', 'lesson', 'results', 'settings', 'hidden'].map(name => ({
    dataset: { asideView: name }, classList: classList(), setAttribute(name, value) { this[name] = value; }
  }));
  const state = { debugEnabled, asideViews, asideButtons, workspace: { classList: classList() }, refreshScoreLayout() {},
    developerModeInput: { checked: debugEnabled }, setDebugEnabled(enabled) { state.debugEnabled = Boolean(enabled); } };
  vm.createContext(state);
  vm.runInContext(functionSource('configureDeveloperPanel') + '\n' + functionSource('setAsideView') + '\n' + functionSource('setDeveloperMode'), state);
  state.configureDeveloperPanel();
  const button = asideButtons.at(-1);
  assert.equal(button.textContent, debugEnabled ? 'Depurar' : 'Ocultar');
  state.setAsideView(button.dataset.asideView);
  assert.equal(asideViews.developer.hidden, !debugEnabled);
  assert.equal(state.workspace.classList.contains('settings-closed'), !debugEnabled);
  assert.equal(button['aria-pressed'], 'true');
  state.setAsideView('lesson');
  assert.equal(asideViews.developer.hidden, true);
  assert.equal(asideViews.lesson.hidden, false);
  if (!debugEnabled) {
    state.setAsideView('developer');
    assert.equal(asideViews.developer.hidden, true, 'el panel solo puede abrirse en modo debug');
  }
  state.setDeveloperMode(true);
  assert.equal(state.developerModeInput.checked, true);
  assert.equal(button.textContent, 'Depurar');
  assert.equal(button['aria-pressed'], 'false', 'cambiar el rótulo no selecciona un panel oculto');
  state.setAsideView('developer');
  assert.equal(asideViews.developer.hidden, false);
  state.setDeveloperMode(false);
  assert.equal(button.textContent, 'Ocultar');
  assert.equal(state.developerModeInput.checked, false);
  assert.equal(asideViews.developer.hidden, true);
  assert.equal(asideViews.settings.hidden, false, 'desactivar desde Depurar devuelve a Configuración');
  state.setAsideView('hidden');
  assert.equal(state.workspace.classList.contains('settings-closed'), true);
  state.setDeveloperMode(true);
  assert.equal(button['aria-pressed'], 'false', 'Depurar no hereda la selección de Ocultar');
  state.setAsideView('developer');
  assert.equal(asideViews.developer.hidden, false);
}
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const developer = html.match(/<aside id="developer-aside"[\s\S]*?<\/aside>/)[0];
const lesson = html.match(/<aside id="lesson-aside"[\s\S]*?<\/aside>/)[0];
for (const id of ['lesson-output', 'json-output', 'expected-output']) {
  assert.ok(developer.includes(`id="${id}"`));
  assert.ok(!lesson.includes(`id="${id}"`));
  assert.equal(html.split(`id="${id}"`).length - 1, 1);
}
assert.equal([...html.matchAll(/data-aside-view=/g)].length, 5);
const settings = html.match(/<aside id="settings-aside"[\s\S]*?<\/aside>/)[0];
assert.ok(/id="developer-mode"[^>]*role="switch"/.test(settings));
console.log('PASS panel Depurar independiente en modo debug; Ocultar conserva su función normal');

// El callback se instala incluso con debug apagado, para poder activarlo
// mientras el mismo reconocedor está siguiendo una interpretación.
let diagnostic;
const calls = [];
const state = {
  debugEnabled: false, jsonScore: {}, activeFullExpectedPerformance: { fromMeasure: 1, toMeasure: 2, events: [] },
  activeRecognizedMeasure() {}, activeRecognitionProgress() {},
  createMeasureRecognizer(score, options) { diagnostic = options.onDebug; return {}; },
  console: { log: (...args) => { if(state.debugEnabled) calls.push(args); } }
};
vm.createContext(state);
vm.runInContext(functionSource('initializeActiveRecognizer'), state);
state.initializeActiveRecognizer(1);
assert.equal(typeof diagnostic, 'function');
diagnostic('intento', { compas: 14 });
assert.equal(calls.length, 0);
state.debugEnabled = true;
diagnostic('intento', { compas: 14 });
assert.equal(calls.length, 1);
assert.equal(calls[0][2], '{"compas":14}');
state.debugEnabled = false;
diagnostic('intento', { compas: 14 });
assert.equal(calls.length, 1);
console.log('PASS trazas activables con un reconocedor ya creado y sin reiniciar la escucha');
