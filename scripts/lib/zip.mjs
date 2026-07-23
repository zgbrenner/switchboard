const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function validatePath(path) {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP path: ${path}`);
  }
  return normalized;
}

export function createStoredZip(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('At least one release file is required.');
  if (files.length > 0xffff) throw new Error('ZIP entry count exceeds the non-ZIP64 limit.');
  const ordered = files
    .map((file) => {
      if (!(file.bytes instanceof Uint8Array)) throw new TypeError(`ZIP file ${file.path} must use Uint8Array bytes.`);
      return { path: validatePath(file.path), bytes: file.bytes };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(ordered.map((file) => file.path)).size !== ordered.length) throw new Error('ZIP paths must be unique.');

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of ordered) {
    const name = encoder.encode(file.path);
    if (name.byteLength > 0xffff || file.bytes.byteLength > 0xffffffff) throw new Error(`ZIP file is too large: ${file.path}`);
    const checksum = crc32(file.bytes);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(33),
      u32(checksum), u32(file.bytes.byteLength), u32(file.bytes.byteLength),
      u16(name.byteLength), u16(0), name, file.bytes,
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(33),
      u32(checksum), u32(file.bytes.byteLength), u32(file.bytes.byteLength),
      u16(name.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset), name,
    ]);
    localParts.push(local);
    centralParts.push(central);
    localOffset += local.byteLength;
    if (localOffset > 0xffffffff) throw new Error('ZIP local data exceeds the non-ZIP64 limit.');
  }
  const central = concat(centralParts);
  if (central.byteLength > 0xffffffff) throw new Error('ZIP central directory exceeds the non-ZIP64 limit.');
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(ordered.length), u16(ordered.length),
    u32(central.byteLength), u32(localOffset), u16(0),
  ]);
  return concat([...localParts, central, end]);
}
