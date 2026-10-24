import { readFile, writeFile, appendFile, mkdir, open, unlink, access, copyFile, readdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpClient } from './mcp-client.mjs';
import { buildPlan, checkObserved, sameTextInventory } from './figure-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pathKey = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);

export class DocumentGuard {
  constructor(client, path) { this.client = client; this.path = path; }
  async check() {
    const info = await this.client.call('get_document_info');
    if (!info.filePath || pathKey(info.filePath) !== pathKey(this.path)) throw new Error('Active document changed; stopped before the next operation. Inspect Illustrator; do not blindly retry.');
    return info;
  }
  async call(name, args) { await this.check(); return this.client.call(name, args); }
}
async function acquireLock() {
  const directory = join(tmpdir(), 'scientific-illustrator-workbench');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'illustrator.lock'), nonce = randomUUID();
  let file;
  try { file = await open(path, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another Workbench session or a retained lock exists: ' + path + '. Inspect its PID and Illustrator before recovery.'); throw error; }
  await file.writeFile(JSON.stringify({ pid: process.pid, nonce, started: new Date().toISOString() }));
  await file.close();
  const release = async () => {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.nonce !== nonce) throw new Error('Lock ownership changed; leaving it untouched');
    await unlink(path);
  };
  release.path = path;
  release.retain = async reason => {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.nonce !== nonce) throw new Error('Lock ownership changed; leaving it untouched');
    await writeFile(path, JSON.stringify({ ...saved, state: 'outcome-unknown', reason }));
  };
  return release;
}
async function runtimePath(options) {
  if (options['runtime-entry']) { const path = resolve(options['runtime-entry']); await access(path); return path; }
  const directory = join(root, '.runtime');
  const manifest = JSON.parse(await readFile(join(directory, 'workbench-runtime.json'), 'utf8').catch(() => { throw new Error('Run node scripts/prepare-runtime.mjs explicitly, or supply an audited --runtime-entry'); }));
  const entry = join(directory, 'dist/bundle.cjs');
  for (const name of ['dist/bundle.cjs', 'dist/jsx/helpers/common.jsx', 'package.json']) {
    if (hash(await readFile(join(directory, name))) !== manifest.runtimeFiles?.[name]) throw new Error('Prepared runtime changed; inspect/reprepare it before running: ' + name);
  }
  return entry;
}
function parseArgs(argv) {
  const [command, ...args] = argv, options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Options require --name value');
    const name = args[i].slice(2);
    if (options[name] !== undefined || !['spec','output','runtime-entry','path','format'].includes(name)) throw new Error('Unknown or duplicate option: ' + name);
    options[name] = args[i+1];
  }
  return { command, options };
}
async function freshDirectory(path) {
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  await mkdir(full); // EEXIST is intentional: output is never reused or replaced.
  return full;
}
export async function readNative(guard) {
  const info = await guard.check();
  const frames = await guard.call('list_text_frames', { coordinate_system: 'artboard-web' });
  const paths = await guard.call('get_path_items', { coordinate_system: 'artboard-web', include_points: false });
  const images = await guard.call('get_images');
  await guard.check();
  return { info, frames, paths, images };
}
async function exportFiles(guard, output, formats = ['png','svg','pdf']) {
  const results = {};
  if (formats.includes('png')) results.png = await guard.call('export', { target: 'artboard:0', format: 'png', output_path: join(output, 'figure.png'), scale: 1.5, raster_options: { dpi: 72, background: 'white', antialiasing: true } });
  if (formats.includes('svg')) results.svg = await guard.call('export', { target: 'artboard:0', format: 'svg', output_path: join(output, 'figure.svg'), svg_options: { text_outline: false, embed_images: false, encoding: 'utf8' } });
  if (formats.includes('pdf')) results.pdf = await guard.call('export_pdf', { output_path: join(output, 'figure.pdf'), options: { downsample: false } });
  const files = [];
  for (const name of await readdir(output)) if (/\.(ai|png|svg|pdf)$/.test(name)) {
    const bytes = await readFile(join(output, name));
    if (!bytes.length) throw new Error('Empty export: ' + name);
    files.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  }
  for (const extension of ['ai',...formats]) if (!files.some(file => file.name.endsWith('.' + extension))) throw new Error('Missing actual export: ' + extension);
  return { results, files };
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!['doctor','plan','render','inspect','export','verify'].includes(command)) throw new Error('Usage: illustrator.mjs doctor | plan --spec FILE [--output NEW_DIR] | render --spec FILE --output NEW_DIR | inspect|verify --path FILE.ai --output NEW_DIR | export --path FILE.ai --format pdf|png|svg --output NEW_DIR');
  let plan;
  if (command === 'plan' || command === 'render') {
    if (!options.spec) throw new Error('--spec is required');
    plan = buildPlan(JSON.parse(await readFile(resolve(options.spec), 'utf8')));
  }
  if (command === 'plan') {
    if (options.output) { const directory = await freshDirectory(options.output); await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2)); }
    console.log(JSON.stringify({ valid: true, operations: plan.operations.length, nodes: plan.spec.nodes.length, canvas: plan.spec.canvas }));
    return;
  }
  if (command !== 'doctor' && !options.output) throw new Error('--output NEW_DIR is required');
  if (['inspect','export','verify'].includes(command) && (!options.path || !/\.ai$/i.test(options.path))) throw new Error('inspect/export/verify requires --path FILE.ai');
  if (command === 'export' && !['pdf','png','svg'].includes(options.format ?? 'pdf')) throw new Error('export --format must be pdf, png or svg');
  const entry = await runtimePath(options);
  const release = await acquireLock();
  let output, client;
  const started = Date.now();
  try {
    if (command !== 'doctor') output = await freshDirectory(options.output);
    client = new McpClient(entry, { onCall: output ? row => appendFile(join(output, 'calls.jsonl'), JSON.stringify(row) + '\n') : undefined });
    await client.start();
    if (client.serverInfo.name !== 'illustrator-mcp-server' || client.serverInfo.version !== '1.10.3') throw new Error('Expected audited illustrator-mcp-server 1.10.3');
    if (command === 'doctor') {
      let document;
      try { document = await client.call('get_document_info'); } catch (error) { document = { unavailable: error.message }; }
      console.log(JSON.stringify({ server: client.serverInfo, tools: client.tools.length, platform: process.platform, document }, null, 2));
      return;
    }
    if (['inspect','export','verify'].includes(command)) {
      const source = resolve(options.path), original = await readFile(source), copied = join(output, 'inspection-copy.ai');
      await copyFile(source, copied);
      await client.call('open_document', { path: copied });
      const guard = new DocumentGuard(client, copied); await guard.check();
      const native = await readNative(guard);
      let editability;
      if (command === 'verify') {
        const frame = native.frames.textFrames[0];
        if (!frame) throw new Error('No native text frame available for a text-edit persistence test');
        const changed = frame.contents + ' [edit test]';
        await guard.call('modify_object', { uuid: frame.uuid, properties: { contents: changed }, coordinate_system: 'artboard-web' });
        await guard.call('save_document', { mode: 'save' });
        await guard.call('close_document', { save: false });
        await client.call('open_document', { path: copied });
        const reopened = await readNative(guard);
        if (!reopened.frames.textFrames.some(item => item.contents === changed)) throw new Error('Native text edit did not persist after reopening');
        editability = { passed: true, method: 'edit-save-close-reopen-native-text', originalText: frame.contents, editedText: changed, reopenedTextFrames: reopened.frames.count };
      }
      const exported = command === 'export' ? await exportFiles(guard, output, [options.format ?? 'pdf']) : undefined;
      if (hash(await readFile(source)) !== hash(original)) throw new Error('Source changed during inspection');
      await writeFile(join(output, 'inspection.json'), JSON.stringify({ inspectedCopy: copied, sourceSha256: hash(original), originalUnchanged: true, ...native, exported, editability }, null, 2));
      console.log(command === 'export' ? 'Exported from a fresh copy; source unchanged:' : command === 'verify' ? 'Native text edit persisted after reopening; source unchanged:' : 'Inspected a fresh copy; source unchanged:', output);
      return;
    }
    await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2));
    const created = await client.call('create_document', { ...plan.spec.canvas, color_mode: 'rgb' });
    const before = await client.call('get_document_info');
    if (before.fileName !== created.fileName) throw new Error('Active document changed immediately after creation');
    const aiPath = join(output, 'figure.ai');
    await client.call('save_document', { mode: 'save_as', path: aiPath, overwrite: false });
    const guard = new DocumentGuard(client, aiPath), observed = [];
    for (const [index, operation] of plan.operations.entries()) {
      const data = await guard.call(operation.tool, operation.args);
      if (!data.verified?.bounds || !data.uuid) throw new Error('Native object readback missing for ' + operation.name);
      observed.push({ name: operation.name, uuid: data.uuid, role: operation.role, parent: operation.parent, bounds: data.verified.bounds });
      if (operation.contents !== undefined && data.verified.contents !== operation.contents) throw new Error('Text readback mismatch: ' + operation.name);
      if ((index + 1) % 10 === 0) console.log('Created and read back', index + 1, '/', plan.operations.length, 'objects');
    }
    const layout = checkObserved(observed, plan.spec.canvas);
    await writeFile(join(output, 'layout-qa.json'), JSON.stringify({ ...layout, observed }, null, 2));
    if (!layout.passed) throw new Error('Measured layout failed: ' + layout.errors.join('; '));
    await guard.check();
    const native = await readNative(guard);
    const actualText = native.frames.textFrames.map(frame => frame.contents);
    if (!sameTextInventory(plan.expectedText, actualText)) throw new Error('Saved-document text inventory differs from plan');
    if (native.images.imageCount !== 0) throw new Error('Unexpected image objects in native vector scaffold');
    await guard.call('save_document', { mode: 'save' });
    const exported = await exportFiles(guard, output);
    await writeFile(join(output, 'native-document.json'), JSON.stringify(native, null, 2));
    await writeFile(join(output, 'manifest.json'), JSON.stringify({ status: 'rendered-and-read-back', schemaVersion: 1, server: client.serverInfo, elapsedMs: Date.now()-started, objectCount: observed.length, textFrames: actualText.length, rasterAndPlacedObjects: native.images.imageCount, layoutPassed: true, visualReview: 'pending', ...exported }, null, 2));
    console.log('Rendered and exported. Inspect the PNG/PDF before accepting visual quality:', output);
  } catch (error) {
    if (client?.unknownOutcome) await release.retain(error.message);
    if (output) await writeFile(join(output, 'failure.json'), JSON.stringify({ status: 'failed', message: error.message, retainedLock: client?.unknownOutcome ? release.path : undefined, outcome: 'Partial new document/files may remain; inspect processes and Illustrator before recovery' }, null, 2));
    throw error;
  } finally { if (client) await client.close(); if (!client?.unknownOutcome) await release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
