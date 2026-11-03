function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

interface FileRecord {
  entry: ZipEntry;
  nameBytes: Uint8Array;
  crc: number;
  method: number;
  compressed: Uint8Array;
  uncompressed: Uint8Array;
  localHeader: Uint8Array;
  offset: number;
}

async function compressDeflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(data as unknown as BufferSource);
    writer.close();
    const compBuf = await new Response(cs.readable).arrayBuffer();
    const compressed = new Uint8Array(compBuf);
    return compressed.length < data.length ? compressed : null;
  } catch {
    return null;
  }
}

export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const fileRecords: FileRecord[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const nameBytes = encoder.encode(cleanPath);
    const uncompressed = entry.data;
    const crc = crc32(uncompressed);

    let compressed = uncompressed;
    let method = 0; // Stored

    const deflated = await compressDeflate(uncompressed);
    if (deflated) {
      compressed = deflated;
      method = 8; // Deflated
    }

    // Local file header: 30 bytes + name length
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0, true); // Flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0, true); // Mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, uncompressed.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    fileRecords.push({
      entry,
      nameBytes,
      crc,
      method,
      compressed,
      uncompressed,
      localHeader,
      offset,
    });

    offset += localHeader.length + compressed.length;
  }

  // Central directory headers
  const centralRecords: Uint8Array[] = [];
  let centralDirSize = 0;

  for (const rec of fileRecords) {
    const cdHeader = new Uint8Array(46 + rec.nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, rec.method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, rec.crc, true);
    cv.setUint32(20, rec.compressed.length, true);
    cv.setUint32(24, rec.uncompressed.length, true);
    cv.setUint16(28, rec.nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal attributes
    cv.setUint32(38, 0, true); // External attributes
    cv.setUint32(42, rec.offset, true); // Offset of local header
    cdHeader.set(rec.nameBytes, 46);

    centralRecords.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  // End of central directory record (EOCD): 22 bytes
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Disk with start of CD
  ev.setUint16(8, fileRecords.length, true);
  ev.setUint16(10, fileRecords.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  // Assemble complete archive
  const totalLength = offset + centralDirSize + eocd.length;
  const zip = new Uint8Array(totalLength);
  let pos = 0;

  for (const rec of fileRecords) {
    zip.set(rec.localHeader, pos);
    pos += rec.localHeader.length;
    zip.set(rec.compressed, pos);
    pos += rec.compressed.length;
  }

  for (const cd of centralRecords) {
    zip.set(cd, pos);
    pos += cd.length;
  }

  zip.set(eocd, pos);
  return zip;
}
