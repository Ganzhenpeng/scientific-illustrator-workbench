import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/native-layout.jsx', import.meta.url), 'utf8');
function setup(board = [100, 900, 1180, 300]) {
  const context = vm.createContext({RGBColor: function () {}, app: {textFonts: {getByName: name => ({name})}}});
  vm.runInContext(source, context);
  const doc = {typename: 'Document', artboards: Object.assign([{artboardRect: board}], {getActiveArtboardIndex: () => 0}), pageItems: []};
  const item = (name, b, typename = 'PathItem') => {
    const result = {name, typename, visibleBounds: b, parent: doc};
    doc.pageItems.push(result); return result;
  };
  return {api: context.ScientificLayout, doc, item};
}

test('visible bounds convert a displaced artboard into top-left coordinates', () => {
  const {api, item} = setup();
  const actual = api.bounds(item('card', [120, 860, 320, 760]));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {left:20,top:40,right:220,bottom:140,width:200,height:100});
});
test('registered text contained in parent passes with complete coverage', () => {
  const {api, doc, item} = setup();
  const audit = new api.Audit(doc);
  audit.add('card', item('card', [120, 860, 320, 760]));
  audit.add('label', item('label', [140, 840, 280, 810], 'TextFrame'), 'text', 'card');
  assert.equal(audit.check().passed, true);
});
test('parent overflow and arrow collision are both observable failures', () => {
  const {api, doc, item} = setup();
  const audit = new api.Audit(doc);
  audit.add('card', item('card', [120, 860, 220, 760]));
  audit.add('label', item('label', [140, 840, 280, 810], 'TextFrame'), 'text', 'card');
  audit.add('connector', item('connector', [200, 830, 350, 820]), 'arrow');
  const report = audit.check();
  assert.equal(report.passed, false);
  assert.deepEqual([...report.errors].map(row => row.code), ['parent-overflow', 'text-arrow-overlap']);
});
test('unregistered decoration fails coverage instead of silently passing', () => {
  const {api, doc, item} = setup();
  const audit = new api.Audit(doc);
  audit.add('main', item('main', [120, 860, 320, 760]));
  item('forgotten-shadow', [125, 765, 315, 740]);
  const report = audit.check();
  assert.equal(report.passed, false);
  assert.equal(report.errors[0].code, 'incomplete-coverage');
  assert.deepEqual([...report.coverage.unregisteredItems], ['forgotten-shadow']);
});
test('bleed allowance is per object and does not hide other overflow', () => {
  const {api, doc, item} = setup();
  const audit = new api.Audit(doc, {tolerance:0});
  audit.add('allowed', item('allowed', [98, 902, 300, 800]), 'shape', null, {allowBleed:2});
  audit.add('not-allowed', item('not-allowed', [100, 902, 300, 800]));
  const report = audit.check();
  assert.deepEqual([...report.errors].map(row => row.name), ['not-allowed']);
});
test('registering a group covers its descendants for coverage accounting', () => {
  const {api, doc, item} = setup();
  const group = item('arrow', [140, 800, 300, 780], 'GroupItem');
  const shaft = item('shaft', [140, 797, 285, 795]); shaft.parent = group;
  const audit = new api.Audit(doc); audit.add('arrow', group, 'arrow');
  assert.equal(audit.check().passed, true);
});
test('bad colors and duplicate audit names fail before claiming success', () => {
  const {api, doc, item} = setup();
  assert.throws(() => api.rgb('blue'), /RRGGBB/);
  const audit = new api.Audit(doc), box = item('a', [120, 860, 320, 760]);
  audit.add('a', box);
  assert.throws(() => audit.add('a', box), /Duplicate/);
});
test('rectangle converts artboard offset and validates radius before mutation', () => {
  const {api, doc} = setup();
  const calls = [];
  const layer = {parent:doc, typename:'Layer', pathItems: {
    rectangle: (...args) => {calls.push(args); return {};},
    roundedRectangle: (...args) => {calls.push(args); return {};},
  }};
  api.rect(layer, 20, 40, 100, 50, {fill:'#ffffff'});
  assert.deepEqual(calls[0], [860, 120, 100, 50]);
  assert.throws(() => api.rect(layer, 20, 40, 100, 50, {radius:40}), /radius/);
  assert.equal(calls.length, 1);
});
