import type { DetectedFileType } from '../shared/types.js';

export interface DetectFileInput {
  name: string;
  declaredType: string;
  bytes: Uint8Array;
}

export interface DetectedFile {
  detectedType: DetectedFileType;
  mediaType: string;
  extension: string;
  warnings: string[];
}

const TYPE_BY_EXTENSION: Readonly<Record<string, DetectedFileType>> = {
  txt: 'text', log: 'text', rtf: 'text', yaml: 'text', yml: 'text', xml: 'text',
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', json: 'json',
  csv: 'csv', tsv: 'csv', pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx',
  zip: 'zip', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
};

const MIME_BY_TYPE: Readonly<Record<DetectedFileType, string>> = {
  text: 'text/plain', markdown: 'text/markdown', html: 'text/html', json: 'application/json',
  csv: 'text/csv', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', image: 'image/*', unknown: 'application/octet-stream',
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function extensionOf(name: string): string {
  const clean = name.split(/[?#]/, 1)[0] ?? name;
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function looksText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 160) printable += 1;
  }
  return printable / sample.length > 0.88;
}

function magicType(bytes: Uint8Array): DetectedFileType | undefined {
  if (startsWith(bytes, [0x25,0x50,0x44,0x46,0x2d])) return 'pdf';
  if (startsWith(bytes, [0x50,0x4b,0x03,0x04]) || startsWith(bytes, [0x50,0x4b,0x05,0x06]) || startsWith(bytes, [0x50,0x4b,0x07,0x08])) return 'zip';
  if (startsWith(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return 'image';
  if (startsWith(bytes, [0xff,0xd8,0xff])) return 'image';
  if (startsWith(bytes, [0x47,0x49,0x46,0x38])) return 'image';
  if (startsWith(bytes, [0x52,0x49,0x46,0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image';
  return undefined;
}

export function detectFileType(input: DetectFileInput): DetectedFile {
  const extension = extensionOf(input.name);
  const extensionType = TYPE_BY_EXTENSION[extension];
  const magic = magicType(input.bytes);
  let detectedType: DetectedFileType;

  if (magic === 'zip' && (extensionType === 'docx' || extensionType === 'pptx' || extensionType === 'xlsx')) {
    detectedType = extensionType;
  } else if (magic) {
    detectedType = magic;
  } else if (looksText(input.bytes)) {
    detectedType = extensionType && ['text','markdown','html','json','csv'].includes(extensionType) ? extensionType : 'text';
  } else {
    detectedType = extensionType ?? 'unknown';
  }

  const warnings: string[] = [];
  if (extensionType && extensionType !== detectedType && !(magic === 'zip' && ['docx','pptx','xlsx'].includes(extensionType))) {
    warnings.push('extension-mismatch');
  }
  const expectedMime = MIME_BY_TYPE[detectedType];
  if (input.declaredType && expectedMime !== 'image/*' && input.declaredType !== expectedMime && !input.declaredType.startsWith('text/')) {
    warnings.push('declared-mime-mismatch');
  }

  return { detectedType, mediaType: expectedMime, extension, warnings };
}
