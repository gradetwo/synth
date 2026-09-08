#!/usr/bin/env node
/**
 * Package `dist/` into deployable artifacts.
 *
 *   release/gs1-synth-<version>.zip       — contents at the web root (extract here)
 *   release/gs1-synth-<version>-dist.zip  — wrapper folder (dist/…)
 *   release/gs1-synth-<version>.tar.gz
 *   release/SHA256SUMS
 *
 * The ZIP writer is dependency-free (Node's zlib + CRC32).
 */
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const release = resolve(root, 'release');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';
mkdirSync(release, { recursive: true });

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32buf(buf) {
  if (typeof crc32 === 'function') return crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const { time, day } = dosDateTime(now);

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32buf(data);
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const read = (f) => readFileSync(f);
const rootEntries = files.map((f) => ({ name: relative(dist, f).split('\\').join('/'), data: read(f) }));
const distEntries = files.map((f) => ({ name: `dist/${relative(dist, f).split('\\').join('/')}`, data: read(f) }));

const zipRoot = join(release, `gs1-synth-${version}.zip`);
writeFileSync(zipRoot, makeZip(rootEntries));
const zipDist = join(release, `gs1-synth-${version}-dist.zip`);
writeFileSync(zipDist, makeZip(distEntries));

// ------------------------------------------------------------------ tar.gz
const tarPath = join(release, `gs1-synth-${version}.tar.gz`);
execFileSync('tar', ['-czf', tarPath, '-C', dist, '.'], { stdio: 'inherit' });

// ---------------------------------------------------------------- checksums
const artifacts = [zipRoot, zipDist, tarPath];
const sums = artifacts
  .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(root, f)}`)
  .join('\n');
writeFileSync(join(release, 'SHA256SUMS'), `${sums}\n`);

console.log('\n[package] artifacts:');
for (const f of [...artifacts, join(release, 'SHA256SUMS')]) {
  console.log(`  ${relative(root, f).padEnd(44)} ${(statSync(f).size / 1024).toFixed(1)} KB`);
}
