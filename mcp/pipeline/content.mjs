const PHRASE_REPLACEMENTS = Object.freeze([
  [/\bin order to\b/giu, 'to'],
  [/\bdue to the fact that\b/giu, 'because'],
  [/\bin the event that\b/giu, 'if'],
  [/\bat this point in time\b/giu, 'now'],
  [/\bfor the purpose of\b/giu, 'for'],
  [/\bwith regard to\b/giu, 'about'],
  [/\bwith respect to\b/giu, 'about'],
  [/\ba large number of\b/giu, 'many'],
  [/\ba small number of\b/giu, 'few'],
  [/\bit is important to note that\b/giu, ''],
  [/\bplease be advised that\b/giu, ''],
  [/\bneedless to say\b/giu, ''],
]);

const FILLER = /\b(?:basically|actually|literally|essentially|generally speaking|in many ways)\b[,.]?\s*/giu;

function preserveOuterWhitespace(source, compressed) {
  const leading = source.match(/^\s*/u)?.[0] ?? '';
  const trailing = source.match(/\s*$/u)?.[0] ?? '';
  const body = compressed.trim();
  return `${leading}${body}${trailing}`;
}

export function deterministicCompressText(text) {
  if (!text.trim()) return text;
  let output = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) output = output.replace(pattern, replacement);
  output = output.replace(FILLER, '');
  output = output.replace(/[ \t]{2,}/gu, ' ');
  output = output.replace(/ +([,.;:!?])/gu, '$1');
  output = output.replace(/\n[ \t]+/gu, '\n');
  return preserveOuterWhitespace(text, output);
}

export function deterministicCompressChunks(chunks) {
  let changed = false;
  const compressed = chunks.map((chunk) => {
    if (chunk.protected) return chunk;
    const text = deterministicCompressText(chunk.text);
    if (text !== chunk.text) changed = true;
    return { ...chunk, text };
  });
  return {
    chunks: compressed,
    model: 'switchboard-deterministic-fallback',
    transforms: changed ? ['deterministic:phrase-compaction'] : [],
    warnings: [],
  };
}
