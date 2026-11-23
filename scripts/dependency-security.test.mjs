import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readlink, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Resolve through actual owners, so tests exercise the installed patched graph.
const emulateRequire = createRequire(import.meta.resolve('@gmacko/emulate'));
const redisRequire = createRequire(emulateRequire.resolve('redis-memory-server'));
const extract = redisRequire('extract-zip');

// image-size@1.2.1 (via metro) hung on nonadvancing ICNS/HEIF/JXL boxes and was
// patched here. Metro 0.87 dropped the dependency, so the patch and its probes
// were removed. If image-size returns, restore the patch and probes first.
test('image-size is not in the installed dependency graph', async () => {
  const lockfile = await readFile(resolve('pnpm-lock.yaml'), 'utf8');
  assert.deepEqual(lockfile.match(/^  '?image-size@[^:]+/gm) ?? [], []);
});

// Minimal stored ZIP writer avoids shell tools and external fixture downloads.
function zipEntry(name, content, mode = 0o120777) {
  const filename = Buffer.from(name); const bytes = Buffer.from(content);
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + bytes.length, 16);
  return Buffer.concat([local, filename, bytes, central, filename, end]);
}

test('extract-zip rejects outside symlink targets and existing ancestor escapes, preserving internal bundle links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bob-archive-security-'));
  try {
    const dir = join(root, 'out'); await mkdir(dir);
    const zip = join(root, 'input.zip');
    for (const target of ['../outside', join(root, 'outside')]) {
      await writeFile(zip, zipEntry('link', target));
      await assert.rejects(extract(zip, { dir }), /Out of bound symlink/);
    }
    await symlink(root, join(dir, 'escape'));
    await writeFile(zip, zipEntry('link', 'escape/does-not-exist'));
    await assert.rejects(extract(zip, { dir }), /Out of bound symlink/);
    await writeFile(zip, zipEntry('link', 'inside.txt'));
    await extract(zip, { dir });
    assert.equal(await readlink(join(dir, 'link')), 'inside.txt');
    await writeFile(zip, zipEntry('inside.txt', 'safe', 0o100644));
    await extract(zip, { dir });
    assert.equal(await readFile(join(dir, 'link'), 'utf8'), 'safe');
    await mkdir(join(dir, 'nested'));
    await symlink('nested', join(dir, 'internal-directory'));
    await writeFile(zip, zipEntry('nested-link', 'internal-directory/future.txt'));
    await extract(zip, { dir });
    assert.equal(await readlink(join(dir, 'nested-link')), 'internal-directory/future.txt');
  } finally { await rm(root, { recursive: true, force: true }); }
});
