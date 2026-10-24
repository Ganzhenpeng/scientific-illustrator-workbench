// Original deterministic scaffold for small horizontal scientific workflows.
export const rgb = hex => ({ type: 'rgb', r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
const NONE = { type: 'none' };
const COLORS = { ink: '#19374A', muted: '#516B7B', blue: '#276AA4', teal: '#167F8A', border: '#BDD3DF', pale: '#F3F8FB' };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const allowedKeys = (value, keys, label) => { for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(label + ': unknown option ' + key); };
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Figure spec must be an object');
  allowedKeys(spec, ['title', 'subtitle', 'canvas', 'nodes', 'edges', 'style', 'sourceNote'], 'spec');
  if (typeof spec.title !== 'string' || !spec.title.trim() || spec.title.length > 100) throw new Error('title must contain 1..100 characters');
  if (spec.subtitle !== undefined && (typeof spec.subtitle !== 'string' || spec.subtitle.length > 160)) throw new Error('Invalid subtitle');
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 1 || spec.nodes.length > 6) throw new Error('Use 1..6 nodes; use the native JSX route for complex diagrams');
  const canvas = { width: 1200, height: 620, ...spec.canvas };
  allowedKeys(canvas, ['width', 'height'], 'canvas');
  if (!finite(canvas.width) || !finite(canvas.height) || canvas.width < 600 || canvas.width > 3000 || canvas.height < 420 || canvas.height > 2000) throw new Error('Canvas dimensions must be finite: width 600..3000, height 420..2000 pt');
  const style = { font: 'ArialMT', fontSize: 20, ...spec.style };
  allowedKeys(style, ['font', 'fontSize'], 'style');
  if (typeof style.font !== 'string' || !style.font || !finite(style.fontSize) || style.fontSize < 8 || style.fontSize > 48) throw new Error('Invalid font/style');
  const ids = new Set();
  for (const node of spec.nodes) {
    if (!node || typeof node !== 'object') throw new Error('Invalid node');
    allowedKeys(node, ['id', 'title', 'subtitle', 'icon'], 'node');
    if (typeof node.id !== 'string' || !/^[a-z][a-z0-9_-]{0,40}$/i.test(node.id) || ids.has(node.id)) throw new Error('Node IDs must be unique identifiers');
    ids.add(node.id);
    if (typeof node.title !== 'string' || !node.title || node.title.length > 80 || /[\r\n]/.test(node.title)) throw new Error('Node title must be a single text block of 1..80 characters');
    if (node.subtitle !== undefined && (typeof node.subtitle !== 'string' || node.subtitle.length > 100 || /[\r\n]/.test(node.subtitle))) throw new Error('Invalid node subtitle');
    if (node.icon !== undefined && !['cell', 'wave', 'fields', 'none'].includes(node.icon)) throw new Error('Unsupported icon');
  }
  const edges = spec.edges ?? spec.nodes.slice(1).map((node, i) => ({ from: spec.nodes[i].id, to: node.id }));
  if (!Array.isArray(edges) || edges.length > spec.nodes.length - 1) throw new Error('Invalid edges');
  const seen = new Set();
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') throw new Error('Invalid edge');
    allowedKeys(edge, ['from', 'to'], 'edge');
    const index = spec.nodes.findIndex(node => node.id === edge.from);
    if (index < 0 || spec.nodes[index + 1]?.id !== edge.to) throw new Error('Automatic routing supports forward adjacent nodes only');
    const key = edge.from + ':' + edge.to;
    if (seen.has(key)) throw new Error('Duplicate edge');
    seen.add(key);
  }
  if (typeof (spec.sourceNote ?? '') !== 'string') throw new Error('Invalid sourceNote');
  return { ...spec, canvas, style, edges };
}
export function contains(parent, child, padding = 0) {
  return child.x >= parent.x + padding - .5 && child.y >= parent.y + padding - .5 && child.x + child.width <= parent.x + parent.width - padding + .5 && child.y + child.height <= parent.y + parent.height - padding + .5;
}
export function overlaps(a, b, padding = 0) {
  return a.x < b.x + b.width + padding && a.x + a.width > b.x - padding && a.y < b.y + b.height + padding && a.y + a.height > b.y - padding;
}
export function sameTextInventory(expected, actual) {
  if (expected.length !== actual.length) return false;
  const normalize = values => values.map(text => text.replace(/\r\n?/g, '\n')).sort();
  const a = normalize(expected), b = normalize(actual);
  return a.every((text, index) => text === b[index]);
}
export function checkObserved(observed, canvas) {
  const errors = [];
  for (const item of observed) {
    if (!item.bounds || !['x','y','width','height'].every(k => finite(item.bounds[k]))) { errors.push(item.name + ': missing measured bounds'); continue; }
    if (!contains({ x: 0, y: 0, ...canvas }, item.bounds)) errors.push(item.name + ': outside artboard');
    if (item.parent && !contains(item.parent, item.bounds, 10)) errors.push(item.name + ': outside parent card');
  }
  const texts = observed.filter(x => x.role === 'text');
  for (const t of texts) for (const a of observed.filter(x => x.role === 'connector')) if (t.bounds && a.bounds && overlaps(t.bounds, a.bounds, 3)) errors.push(t.name + ': overlaps ' + a.name);
  for (let i = 0; i < texts.length; i++) for (const b of texts.slice(i + 1)) if (texts[i].bounds && b.bounds && overlaps(texts[i].bounds, b.bounds, 1)) errors.push(texts[i].name + ': overlaps text ' + b.name);
  return { passed: errors.length === 0, errors, measuredObjects: observed.length };
}
export function buildPlan(input) {
  const spec = validateSpec(input), { width: W, height: H } = spec.canvas;
  const scale = Math.min(W / 1200, H / 620), margin = 60 * scale, gap = 48 * scale;
  const cw = (W - 2 * margin - gap * (spec.nodes.length - 1)) / spec.nodes.length;
  if (cw < 160 * scale) throw new Error('Canvas too narrow for the node count');
  const cy = 177 * scale, ch = H - cy - 115 * scale;
  const operations = [], nodes = new Map();
  function op(tool, args, meta) { operations.push({ tool, args: { ...args, coordinate_system: 'artboard-web' }, ...meta }); }
  function rect(name, x, y, width, height, fill, stroke, meta = {}) {
    op('create_rectangle', { x, y, width, height, fill: rgb(fill), stroke: { color: stroke ? rgb(stroke) : NONE, width: 1.1 * scale }, name }, { name, role: 'geometry', ...meta });
  }
  function path(name, pts, color, weight, role = 'geometry', parent) {
    op('create_path', { anchors: pts.map(([x,y]) => ({x,y})), closed: false, fill: NONE, stroke: { color: rgb(color), width: weight * scale }, name }, { name, role, parent });
  }
  function text(name, contents, x, y, size, color, parent) {
    op('create_text_frame', { contents, x, y, font_name: spec.style.font, font_size: size * scale, fill: rgb(color), justification: 'center', name }, { name, role: 'text', parent, contents });
  }
  rect('background', 0, 0, W, H, '#FFFFFF');
  text('figure-title', spec.title, W / 2, 73 * scale, 30, COLORS.ink);
  if (spec.subtitle) text('figure-subtitle', spec.subtitle, W / 2, 110 * scale, 14, COLORS.muted);
  path('header-rule', [[margin, 139 * scale],[W-margin,139*scale]], COLORS.border, 1);
  spec.nodes.forEach((node, i) => {
    const x = margin + i * (cw + gap), center = x + cw / 2;
    const parent = { x, y: cy, width: cw, height: ch };
    nodes.set(node.id, parent);
    rect(node.id + '-card', x, cy, cw, ch, COLORS.pale, COLORS.border);
    const accent = i % 2 ? COLORS.teal : COLORS.blue;
    rect(node.id + '-accent', x + 16 * scale, cy + 15 * scale, 34 * scale, 3 * scale, accent, null, { parent });
    text(node.id + '-index', String(i + 1).padStart(2,'0'), center, cy + 46 * scale, 12, accent, parent);
    const iy = cy + 84 * scale, iw = Math.min(cw - 52 * scale, 122 * scale), left = center - iw/2;
    if (node.icon === 'cell') {
      for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) rect(node.id + '-cell-' + r + '-' + c, left + c * iw/4, iy + r*19*scale, iw/4,19*scale,(r+c)%2 ? COLORS.teal : COLORS.blue,'#FFFFFF',{parent});
    } else if (node.icon === 'wave' || node.icon === 'fields') {
      for (let row = 0; row < (node.icon === 'fields' ? 2 : 1); row++) {
        const points = Array.from({length: 33}, (_,j) => [left + iw*j/32, iy + 12*scale + row*28*scale + Math.sin(j/32*Math.PI*2)*12*scale]);
        path(node.id + '-curve-' + row, points, row ? COLORS.teal : accent, 2.2, 'geometry', parent);
      }
    }
    text(node.id + '-title', node.title, center, cy + ch * .66, spec.style.fontSize, COLORS.ink, parent);
    if (node.subtitle) text(node.id + '-subtitle', node.subtitle, center, cy + ch * .66 + 31 * scale, spec.style.fontSize * .76, COLORS.muted, parent);
  });
  for (const [index, edge] of spec.edges.entries()) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to), y = cy + ch*.52;
    const tip = b.x - 10*scale, start = a.x + a.width + 10*scale;
    path('edge-' + index + '-shaft', [[start,y],[tip-7*scale,y]], COLORS.blue, 1.8, 'connector');
    op('create_path', { anchors: [{x:tip,y},{x:tip-7*scale,y:y-4*scale},{x:tip-7*scale,y:y+4*scale}], closed:true,fill:rgb(COLORS.blue),stroke:{color:NONE},name:'edge-'+index+'-head' }, {name:'edge-'+index+'-head',role:'connector'});
  }
  text('figure-footer', 'Editable paths and text', W/2, H-44*scale, 12, COLORS.muted);
  return { schemaVersion: 1, spec, operations, expectedText: operations.filter(x=>x.contents !== undefined).map(x=>x.contents) };
}
