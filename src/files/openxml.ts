import { extractZipEntries, inspectZipCentralDirectory } from './zip.js';
import { extractTagValues, xmlText } from './xml.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

export interface OpenXmlExtraction {
  text: string;
  metadata: Record<string, string | number | boolean>;
  warnings: string[];
}

export async function extractDocx(bytes: Uint8Array): Promise<OpenXmlExtraction> {
  inspectZipCentralDirectory(bytes);
  const entries = await extractZipEntries(bytes, (name) => name === 'word/document.xml' || name.startsWith('word/header') || name.startsWith('word/footer'));
  const document = entries.get('word/document.xml');
  if (!document) throw new Error('DOCX is missing word/document.xml.');
  const ordered = [...entries.entries()].sort(([left], [right]) => left.localeCompare(right));
  const text = ordered.map(([, data]) => xmlText(decoder.decode(data))).filter(Boolean).join('\n\n');
  return { text, metadata: { parts: entries.size }, warnings: [] };
}

export async function extractPptx(bytes: Uint8Array): Promise<OpenXmlExtraction> {
  inspectZipCentralDirectory(bytes);
  const entries = await extractZipEntries(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
  const ordered = [...entries.entries()].sort(([left], [right]) => {
    const leftNumber = Number(left.match(/slide(\d+)/i)?.[1] ?? 0);
    const rightNumber = Number(right.match(/slide(\d+)/i)?.[1] ?? 0);
    return leftNumber - rightNumber;
  });
  const slides = ordered.map(([, data], index) => {
    const text = extractTagValues(decoder.decode(data), 't').join(' ');
    return `Slide ${index + 1}\n${text}`;
  });
  return { text: slides.join('\n\n'), metadata: { slides: slides.length }, warnings: [] };
}

export async function extractXlsx(bytes: Uint8Array): Promise<OpenXmlExtraction> {
  inspectZipCentralDirectory(bytes);
  const entries = await extractZipEntries(bytes, (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  const sharedXml = entries.get('xl/sharedStrings.xml');
  const shared = sharedXml ? extractTagValues(decoder.decode(sharedXml), 'si') : [];
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));

  const output: string[] = [];
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const pair = sheets[sheetIndex];
    if (!pair) continue;
    const [, data] = pair;
    const xml = decoder.decode(data);
    output.push(`Sheet ${sheetIndex + 1}`);
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    for (const match of xml.matchAll(cellPattern)) {
      const attrs = match[1] ?? '';
      const body = match[2] ?? '';
      const ref = /\br="([^"]+)"/i.exec(attrs)?.[1] ?? '';
      const type = /\bt="([^"]+)"/i.exec(attrs)?.[1] ?? '';
      const raw = /<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/i.exec(body)?.[1] ?? '';
      const value = type === 's' ? (shared[Number(raw)] ?? raw) : xmlText(raw);
      if (value) output.push(`${ref}: ${value}`);
    }
    output.push('');
  }
  return { text: output.join('\n').trim(), metadata: { sheets: sheets.length, sharedStrings: shared.length }, warnings: [] };
}
