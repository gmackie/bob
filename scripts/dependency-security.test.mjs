import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readlink, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
// Resolve through actual owners, so tests exercise the installed patched graph.
const expoRequire = createRequire(require.resolve('expo/package.json', { paths: [resolve('apps/mobile-bob')] }));
const expoMetroRequire = createRequire(expoRequire.resolve('@expo/metro/package.json'));
const metroRequire = createRequire(expoMetroRequire.resolve('metro/package.json'));
const imageModule = metroRequire.resolve('image-size');
const emulateRequire = createRequire(import.meta.resolve('@gmacko/emulate'));
const redisRequire = createRequire(emulateRequire.resolve('redis-memory-server'));
const extract = redisRequire('extract-zip');

function imageProbe(buffer) {
  return execFileSync(process.execPath, ['-e', `
    const size = require(${JSON.stringify(imageModule)});
    try { size(Buffer.from(process.argv[1], 'hex')); process.exit(2); }
    catch (error) { if (!(error instanceof TypeError)) throw error; }
  `, buffer.toString('hex')], { timeout: 2000 });
}

test('image-size rejects nonadvancing ICNS, HEIF and JXL boxes without blocking the event loop', () => {
  const icns = Buffer.alloc(16); icns.write('icns'); icns.writeUInt32BE(16, 4); icns.write('ic07', 8);
  imageProbe(icns);
  const heif = Buffer.alloc(24); heif.write('ftyp', 4); heif.write('heic', 8);
  imageProbe(heif);
  const jxl = Buffer.alloc(32); jxl.writeUInt32BE(12); jxl.write('JXL ', 4); jxl.write('ftyp', 16); jxl.write('jxl ', 20);
  imageProbe(jxl);
});

test('image-size still reads a valid PNG', () => {
  const imageSize = require(imageModule);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  assert.deepEqual(imageSize(png), { width: 1, height: 1, type: 'png' });
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
