const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? `&${entity};`;
  });
}

export function xmlText(xml: string): string {
  return decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/(?:w:p|a:p|row|si)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function extractTagValues(xml: string, localName: string): string[] {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${localName}>`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => xmlText(match[1] ?? ''));
}
