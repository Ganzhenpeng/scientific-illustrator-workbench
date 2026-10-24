import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPlan, checkObserved, sameTextInventory } from '../scripts/figure-plan.mjs';
import { DocumentGuard, readNative } from '../scripts/illustrator.mjs';
const example = JSON.parse(await readFile(new URL('../examples/workflow.json', import.meta.url), 'utf8'));
test('every generated object has a stable unique name; native text content survives planning', () => {
  const plan = buildPlan(example);
  assert.equal(new Set(plan.operations.map(op=>op.name)).size, plan.operations.length);
  assert(plan.operations.every(op=>op.args.name === op.name));
  for (const n of example.nodes) { assert(plan.expectedText.includes(n.title)); assert(plan.expectedText.includes(n.subtitle)); }
});
test('invalid endpoints, duplicates, unknown options and non-finite dimensions fail before automation', () => {
  for (const patch of [ {edges:[{from:'cell',to:'recover'}]}, {edges:[{from:'cell',to:'bloch'},{from:'cell',to:'bloch'}]}, {unexpected:true}, {canvas:{width:NaN,height:620}}, {style:{font:'ArialMT',fontSize:0}} ]) assert.throws(()=>buildPlan({...example,...patch}));
  assert.throws(()=>buildPlan({...example,nodes:[example.nodes[0],example.nodes[0]]}));
  assert.throws(()=>buildPlan({title:'Test',nodes:[{title:'Missing ID'}]}));
});
test('repeated labels are checked with their actual multiplicity',()=>{
 assert.equal(sameTextInventory(['A','B','B'],['A','A','B']),false);
 assert.equal(sameTextInventory(['A','B','B'],['B','A','B']),true);
});
test('measured text escaping a card or hitting a connector fails', () => {
  const parent={x:10,y:10,width:80,height:100};
  const outside={name:'label',role:'text',parent,bounds:{x:70,y:40,width:70,height:20}};
  assert.equal(checkObserved([outside],{width:300,height:200}).passed,false);
  const inside={name:'label',role:'text',bounds:{x:30,y:40,width:50,height:20}};
  const arrow={name:'arrow',role:'connector',bounds:{x:70,y:45,width:30,height:4}};
  assert.equal(checkObserved([inside,arrow],{width:300,height:200}).passed,false);
});
test('unmeasured decoration and off-artboard objects cannot pass as verified', () => {
  assert.equal(checkObserved([{name:'shade',role:'geometry'}],{width:300,height:200}).passed,false);
  assert.equal(checkObserved([{name:'shade',bounds:{x:0,y:190,width:20,height:25}}],{width:300,height:200}).passed,false);
});
test('active-document mismatch prevents the mutation and does not retry it', async () => {
  const calls=[];
  const fake={call:async(name)=>{calls.push(name);return {filePath:'/another/figure.ai'};}};
  const guard=new DocumentGuard(fake,'/expected/figure.ai');
  await assert.rejects(guard.call('create_rectangle',{}),/Active document changed/);
  assert.deepEqual(calls,['get_document_info']);
});
test('matching document permits exactly one requested mutation', async () => {
  const calls=[];
  const fake={call:async(name)=>{calls.push(name);return {filePath:'/expected/figure.ai'};}};
  await new DocumentGuard(fake,'/expected/figure.ai').call('create_rectangle',{});
  assert.deepEqual(calls,['get_document_info','create_rectangle']);
});
test('native inventory stops when a document switches between read tools',async()=>{
 const calls=[]; let changed=false;
 const fake={call:async(name)=>{calls.push(name);if(name==='list_text_frames'){changed=true;return {textFrames:[]};}return {filePath:changed?'/another.ai':'/expected.ai'};}};
 await assert.rejects(readNative(new DocumentGuard(fake,'/expected.ai')),/Active document changed/);
 assert(!calls.includes('get_path_items'));assert(!calls.includes('get_images'));
});
