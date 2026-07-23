import type { DetectedFileType, FileInsight } from '../shared/types.js';
import { detectFileType } from './detect.js';
import { extractDocx, extractPptx, extractXlsx } from './openxml.js';
import { extractBasicPdf } from './pdf.js';
import { inspectZipCentralDirectory } from './zip.js';

export interface FileInspectionLimits {
  maxFileBytes: number;
  maxExtractedCharacters: number;
  longContextCharacters: number;
}

export interface InspectBytesInput {
  name: string;
  declaredType: string;
  bytes: Uint8Array;
  limits?: Partial<FileInspectionLimits>;
}

const DEFAULT_LIMITS: FileInspectionLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxExtractedCharacters: 200_000,
  longContextCharacters: 24_000,
};

function htmlToText(input: string): string {
  return input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function excerpt(text: string, limit: number): string {
  const normalized = text.replace(/\u0000/g, '').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}\n…`;
}

function isTextType(type: DetectedFileType): boolean {
  return ['text', 'markdown', 'html', 'json', 'csv'].includes(type);
}

export async function inspectBytes(input: InspectBytesInput): Promise<FileInsight> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  if (input.bytes.byteLength > limits.maxFileBytes) {
    throw new Error(`${input.name} exceeds the ${limits.maxFileBytes} byte limit.`);
  }

  const detected = detectFileType(input);
  const warnings = [...detected.warnings];
  let text = '';
  let metadata: Record<string, string | number | boolean> = {};
  let needsVision = detected.detectedType === 'image';

  if (isTextType(detected.detectedType)) {
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    text = detected.detectedType === 'html' ? htmlToText(decoded) : decoded;
    if (detected.detectedType === 'json') {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        warnings.push('invalid-json');
      }
    }
  } else if (detected.detectedType === 'pdf') {
    const result = extractBasicPdf(input.bytes);
    text = result.text;
    metadata = { pages: result.pageCount, images: result.imageCount };
    warnings.push(...result.warnings);
    needsVision = result.needsVision;
  } else if (detected.detectedType === 'docx') {
    const result = await extractDocx(input.bytes);
    text = result.text; metadata = result.metadata; warnings.push(...result.warnings);
  } else if (detected.detectedType === 'pptx') {
    const result = await extractPptx(input.bytes);
    text = result.text; metadata = result.metadata; warnings.push(...result.warnings);
  } else if (detected.detectedType === 'xlsx') {
    const result = await extractXlsx(input.bytes);
    text = result.text; metadata = result.metadata; warnings.push(...result.warnings);
  } else if (detected.detectedType === 'zip') {
    const entries = inspectZipCentralDirectory(input.bytes);
    metadata = { entries: entries.length, uncompressedBytes: entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0) };
    text = entries.slice(0, 200).map((entry) => entry.name).join('\n');
    warnings.push('archive-listing-only');
  } else if (detected.detectedType === 'unknown') {
    warnings.push('unsupported-file-type');
  }

  if (text.length > limits.maxExtractedCharacters) {
    warnings.push('extracted-text-truncated');
    text = text.slice(0, limits.maxExtractedCharacters);
  }

  const insight: FileInsight = {
    name: input.name,
    size: input.bytes.byteLength,
    detectedType: detected.detectedType,
    mediaType: detected.mediaType,
    textLength: text.length,
    excerpt: excerpt(text, 12_000),
    warnings: [...new Set(warnings)],
    capabilities: {
      files: true,
      vision: needsVision,
      longContext: text.length >= limits.longContextCharacters,
    },
  };
  if (Object.keys(metadata).length > 0) insight.metadata = metadata;
  return insight;
}

export async function inspectFile(file: File, limits?: Partial<FileInspectionLimits>): Promise<FileInsight> {
  return inspectBytes({
    name: file.name,
    declaredType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    ...(limits ? { limits } : {}),
  });
}
