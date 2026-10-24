import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
test('an untrusted archive cannot create a runnable runtime directory',async()=>{
 const parent=tmpdir(), work=await mkdtemp(join(parent,'illustrator-setup-test-'));
 try {
  const archive=join(work,'invalid.tgz'), destination=join(work,'runtime');
  await writeFile(archive,'synthetic invalid archive');
  const script=fileURLToPath(new URL('../scripts/prepare-runtime.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'--archive',archive,'--directory',destination],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/integrity mismatch/);
  await assert.rejects(access(destination));
 } finally {
  const target=resolve(work);
  assert.equal(dirname(target),resolve(parent));assert(basename(target).startsWith('illustrator-setup-test-'));
  await rm(target,{recursive:true,force:true});
 }
});
