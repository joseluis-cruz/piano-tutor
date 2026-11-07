import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const extract = name => {
  const start = app.indexOf(`function ${name}(`);
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const svg = {
  children: [],
  querySelectorAll() { return [...this.children]; },
  querySelector(selector) {
    const measure = selector.match(/background="(\d+)"/)[1];
    return this.children.find(rect => rect.getAttribute('data-pt-measure-background') === measure &&
      (!selector.includes('evaluated-hand') || rect.getAttribute('data-pt-evaluated-hand') === 'true'));
  },
  insertBefore(rect) { this.children.push(rect); },
  append(rect) { this.children.push(rect); }
};
const element = tag => ({
  localName: tag, style: {}, attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  getAttribute(name) { return this.attributes[name]; },
  remove() { svg.children = svg.children.filter(child => child !== this); }
});
const measure = (x, y) => ({ stave: {
  getX: () => x, getY: () => y, getWidth: () => 100, getBottomLineY: () => y + 40
} });
const state = {
  $: () => svg, document: { createElementNS: (_, tag) => element(tag) },
  osmd: { GraphicSheet: { MeasureList: [[measure(0, 10), measure(0, 100)], [measure(100, 10), measure(100, 100)]] } },
  jsonScore: { ppq: 480, events: [{ type: 'startOfMeasure', measure: 1 }] },
  lesson: {}, fromInput: { value: '1' }, toInput: { value: '1' },
  activeListening: false, activeWaitingMeasure: 1, activeInitialVisitedMeasures: new Set(),
  evaluatedMeasures: new Map([[1, '#00ff00']]), evaluatedStaffs: new Set(),
  showEvaluationMeasureBackgrounds: true,
  PT_OUTSIDE_LESSON_COLOR: '#808080', PT_OUTSIDE_LESSON_ALPHA: .17,
  PT_EVALUATION_MEASURE_ALPHA: .20, PT_UNEVALUATED_STAFF_COLOR: '#d9dde2', PT_UNEVALUATED_STAFF_ALPHA: .20,
  ACTIVE_WAITING_COLOR: '#fff2b7', ACTIVE_WAITING_OPACITY: .25,
  renderUnexpectedMarkers() {}, keepActiveCursorAboveHighlights() {}
};
vm.createContext(state);
vm.runInContext(extract('renderMeasureHighlights'), state);
for (const staff of [1, 2]) {
  state.evaluatedStaffs = new Set([staff]);
  state.renderMeasureHighlights();
  const result = svg.children.filter(rect => rect.getAttribute('data-pt-measure-background') === '1');
  assert.equal(result.length, 2);
  const evaluated = result.find(rect => rect.getAttribute('data-pt-staff') === String(staff));
  const other = result.find(rect => rect !== evaluated);
  assert.equal(evaluated.getAttribute('fill'), '#00ff00');
  assert.equal(other.getAttribute('fill'), '#d9dde2');
  assert.equal(other.getAttribute('fill-opacity'), '0.2');
  assert.ok(!other.getAttribute('data-pt-evaluated-hand'));
  assert.equal(svg.children.filter(rect => rect.getAttribute('data-pt-measure-background') === '2').length, 1);
}
// Con ambas manos se conserva el sombreado de compás completo.
state.evaluatedStaffs = new Set([1, 2]);
state.renderMeasureHighlights();
assert.equal(svg.children.length, 2);
assert.equal(svg.children[0].getAttribute('height'), '130');
// En escucha, el amarillo continúa abarcando ambas manos.
state.evaluatedStaffs = new Set([1]); state.activeListening = true;
state.renderMeasureHighlights();
assert.equal(svg.children[0].getAttribute('fill'), '#fff2b7');
assert.equal(svg.children[0].getAttribute('height'), '130');
// Los puntos inesperados se sitúan sobre la mano evaluada, incluida la izquierda.
state.activeListening = false; state.evaluatedStaffs = new Set([2]); state.renderMeasureHighlights();
state.evaluatedUnexpected = [{ measure: 1, tick: 240 }];
state.measureStartTick = number => (number - 1) * 960;
state.updateSelectedUnexpectedMarker = () => {};
svg.querySelectorAll = () => [];
vm.runInContext(extract('renderUnexpectedMarkers'), state);
state.renderUnexpectedMarkers(svg);
assert.equal(svg.children.at(-1).getAttribute('cy'), '120');
console.log('PASS fondos por mano: gris claro, resultados, ambas manos, escucha y puntos inesperados');
