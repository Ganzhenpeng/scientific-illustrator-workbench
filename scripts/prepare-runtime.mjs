// Explicit setup only: verify a pinned archive, inspect its members, use system tar. No npm hooks.
import { readFile, writeFile, mkdir, mkdtemp, rename, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'runtime-lock.json'), 'utf8'));
async function removeOwned(path, parent, prefix) {
  const full = resolve(path);
  if (dirname(full) !== resolve(parent) || !basename(full).startsWith(prefix)) throw new Error('Refusing cleanup outside owned staging directory');
  await rm(full, { recursive: true, force: true });
}
const args = process.argv.slice(2);
const destIndex = args.indexOf('--directory');
const destination = resolve(destIndex >= 0 ? args[destIndex + 1] : join(root, '.runtime'));
try { await access(destination); throw new Error('Runtime directory exists; use its entry or choose a new --directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const archiveIndex = args.indexOf('--archive');
const archive = archiveIndex >= 0 ? await readFile(resolve(args[archiveIndex + 1])) : await (async () => {
  const response = await fetch(lock.tarball, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error('Runtime download HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
})();
const actual = 'sha512-' + createHash('sha512').update(archive).digest('base64');
if (actual !== lock.integrity) throw new Error('Runtime integrity mismatch: nothing extracted');
const scratch = await mkdtemp(join(tmpdir(), 'scientific-illustrator-runtime-'));
try {
  const archivePath = join(scratch, 'runtime.tgz');
  await writeFile(archivePath, archive);
  const names = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
  const details = execFileSync('tar', ['-tvzf', archivePath], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
  if (details.some(row => !['-', 'd'].includes(row[0]))) throw new Error('Archive contains links or unsupported member types');
  if (names.some(name => !name.startsWith('package/') || isAbsolute(name) || name.includes('\\') || name.split('/').includes('..'))) throw new Error('Unsafe archive member');
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), '.runtime-stage-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', stage, '--strip-components', '1'], { windowsHide: true });
    const pkg = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
    if (pkg.name !== lock.package || pkg.version !== lock.version) throw new Error('Unexpected runtime identity');
    await access(join(stage, lock.entry));
    const runtimeFiles = {};
    for (const name of ['dist/bundle.cjs', 'dist/jsx/helpers/common.jsx', 'package.json']) runtimeFiles[name] = createHash('sha256').update(await readFile(join(stage,name))).digest('hex');
    await writeFile(join(stage, 'workbench-runtime.json'), JSON.stringify({ ...lock, verifiedIntegrity: actual, runtimeFiles }, null, 2));
    await rename(stage, destination);
  } catch (error) { await removeOwned(stage, dirname(destination), '.runtime-stage-'); throw error; }
} finally { await removeOwned(scratch, tmpdir(), 'scientific-illustrator-runtime-'); }
console.log('Verified runtime ready:', join(destination, lock.entry));
