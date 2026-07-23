export interface ZipSafetyLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
}

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const DEFAULT_LIMITS: ZipSafetyLimits = {
  maxEntries: 512,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 200,
};

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function signature(view: DataView, offset: number): number {
  return u32(view, offset);
}
function findEndRecord(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (signature(view, offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP end-of-central-directory record was not found.');
}
function safeName(name: string): void {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP entry path: ${name}`);
  }
}

export function inspectZipCentralDirectory(bytes: Uint8Array, limits: Partial<ZipSafetyLimits> = {}): ZipEntry[] {
  const applied = { ...DEFAULT_LIMITS, ...limits };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(bytes);
  const entryCount = u16(view, endOffset + 10);
  const centralSize = u32(view, endOffset + 12);
  const centralOffset = u32(view, endOffset + 16);

  if (entryCount > applied.maxEntries) throw new Error(`ZIP has ${entryCount} entries, above the ${applied.maxEntries} entry limit.`);
  if (centralOffset + centralSize > bytes.length) throw new Error('ZIP central directory points outside the file.');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;

  while (offset < centralOffset + centralSize && entries.length < entryCount) {
    if (offset + 46 > bytes.length || signature(view, offset) !== 0x02014b50) throw new Error('Malformed ZIP central-directory entry.');
    const compressionMethod = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localHeaderOffset = u32(view, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('Malformed ZIP entry length.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    safeName(name);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > applied.maxUncompressedBytes) {
      throw new Error(`ZIP uncompressed size limit of ${applied.maxUncompressedBytes} bytes exceeded.`);
    }
    if (compressedSize === 0 && uncompressedSize > 0) throw new Error(`ZIP entry ${name} has an invalid compression ratio.`);
    if (compressedSize > 0 && uncompressedSize / compressedSize > applied.maxCompressionRatio) {
      throw new Error(`ZIP entry ${name} exceeds the ${applied.maxCompressionRatio}:1 compression-ratio limit.`);
    }
    if (![0, 8].includes(compressionMethod)) throw new Error(`ZIP entry ${name} uses unsupported compression method ${compressionMethod}.`);

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset = end;
  }

  if (entries.length !== entryCount) throw new Error('ZIP central-directory entry count did not match its header.');
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Deflate extraction is unavailable in this browser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean, limits: Partial<ZipSafetyLimits> = {}): Promise<Map<string, Uint8Array>> {
  const entries = inspectZipCentralDirectory(bytes, limits);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (!wanted(entry.name) || entry.name.endsWith('/')) continue;
    const offset = entry.localHeaderOffset;
    if (offset + 30 > bytes.length || signature(view, offset) !== 0x04034b50) throw new Error(`Missing local ZIP header for ${entry.name}.`);
    const nameLength = u16(view, offset + 26);
    const extraLength = u16(view, offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new Error(`ZIP data for ${entry.name} points outside the file.`);
    const compressed = bytes.subarray(start, end);
    const data = entry.compressionMethod === 0 ? compressed.slice() : await inflateRaw(compressed);
    if (data.length !== entry.uncompressedSize) throw new Error(`ZIP entry ${entry.name} expanded to an unexpected size.`);
    result.set(entry.name, data);
  }
  return result;
}
