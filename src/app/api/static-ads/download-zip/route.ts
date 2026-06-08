import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/static-ads/download-zip
 * Body: { creativeIds: string[] }
 * Returns a ZIP file containing all requested creative PNGs.
 */
export async function POST(req: NextRequest) {
  const { creativeIds } = await req.json();
  if (!creativeIds?.length) {
    return NextResponse.json({ error: 'creativeIds required' }, { status: 400 });
  }

  const db = getDb();
  const files: { name: string; data: Buffer }[] = [];

  for (const id of creativeIds) {
    const creative: any = db.prepare(
      'SELECT store_id, title FROM creatives WHERE id = ?'
    ).get(id);
    if (!creative) continue;

    const filePath = path.join(process.cwd(), 'static-ads', creative.store_id, `${id}.png`);
    if (!fs.existsSync(filePath)) continue;

    const safeName = (creative.title || id).replace(/[^a-zA-Z0-9_ -]/g, '').slice(0, 60).trim();
    files.push({
      name: `${safeName}.png`,
      data: fs.readFileSync(filePath),
    });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files found' }, { status: 404 });
  }

  // Build ZIP manually (no external dependency)
  const zipBuffer = buildZip(files);

  return new NextResponse(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="static-ads-${Date.now()}.zip"`,
    },
  });
}

// Minimal ZIP builder — stores files uncompressed (PNGs are already compressed)
function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);

    // Local file header (30 + name length)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(0, 8);             // compression (0 = stored)
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0, 12);            // mod date
    local.writeUInt32LE(crc, 14);          // crc-32
    local.writeUInt32LE(file.data.length, 18);  // compressed size
    local.writeUInt32LE(file.data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26); // name length
    local.writeUInt16LE(0, 28);            // extra length

    parts.push(local, nameBuffer, file.data);

    // Central directory entry (46 + name length)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);  // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // compression
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(crc, 16);        // crc-32
    central.writeUInt32LE(file.data.length, 20);  // compressed size
    central.writeUInt32LE(file.data.length, 24);  // uncompressed size
    central.writeUInt16LE(nameBuffer.length, 28); // name length
    central.writeUInt16LE(0, 30);          // extra length
    central.writeUInt16LE(0, 32);          // comment length
    central.writeUInt16LE(0, 34);          // disk start
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset

    centralDir.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + file.data.length;
  }

  const centralDirSize = centralDir.reduce((s, b) => s + b.length, 0);

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // signature
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // disk with central dir
  eocd.writeUInt16LE(files.length, 8);     // entries on this disk
  eocd.writeUInt16LE(files.length, 10);    // total entries
  eocd.writeUInt32LE(centralDirSize, 12);  // central dir size
  eocd.writeUInt32LE(offset, 16);          // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...parts, ...centralDir, eocd]);
}

// CRC-32 implementation
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();
