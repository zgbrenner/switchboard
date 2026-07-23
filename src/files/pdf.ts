export interface PdfExtraction {
  text: string;
  pageCount: number;
  imageCount: number;
  warnings: string[];
  needsVision: boolean;
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[escaped] ?? escaped))
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

export function extractBasicPdf(bytes: Uint8Array): PdfExtraction {
  const raw = new TextDecoder('latin1').decode(bytes);
  const pageCount = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const imageCount = (raw.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
  const fragments: string[] = [];

  for (const match of raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj\b/g)) fragments.push(decodePdfString(match[1] ?? ''));
  for (const match of raw.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ\b/g)) {
    const body = match[1] ?? '';
    for (const stringMatch of body.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) fragments.push(decodePdfString(stringMatch[1] ?? ''));
  }

  const text = fragments.join(' ').replace(/\s+/g, ' ').trim();
  const warnings: string[] = [];
  if (!text) warnings.push(imageCount > 0 ? 'scanned-pdf' : 'pdf-text-extraction-limited');
  return { text, pageCount, imageCount, warnings, needsVision: !text && imageCount > 0 };
}
