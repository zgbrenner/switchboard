const DEFAULT_MAX_CHARACTERS = 6_000;
const MIN_SPLIT_FRACTION = 0.55;

function splitPoint(text, start, limit) {
  const minimum = start + Math.floor((limit - start) * MIN_SPLIT_FRACTION);
  const candidates = [
    { token: '\n\n', include: 2 },
    { token: '\n', include: 1 },
    { pattern: /[.!?]["')\]]?\s/gu },
    { pattern: /[,;:]\s/gu },
    { pattern: /\s/gu },
  ];

  for (const candidate of candidates) {
    if (candidate.token) {
      const index = text.lastIndexOf(candidate.token, limit);
      if (index >= minimum) return index + candidate.include;
      continue;
    }
    candidate.pattern.lastIndex = minimum;
    let last = -1;
    for (let match = candidate.pattern.exec(text); match && match.index < limit; match = candidate.pattern.exec(text)) {
      last = match.index + match[0].length;
    }
    if (last >= minimum) return last;
  }
  return limit;
}

function splitPlainSegment(text, startOffset, maxCharacters) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hardLimit = Math.min(text.length, cursor + maxCharacters);
    const end = hardLimit === text.length ? text.length : splitPoint(text, cursor, hardLimit);
    chunks.push({
      text: text.slice(cursor, end),
      protected: false,
      start: startOffset + cursor,
      end: startOffset + end,
    });
    cursor = end;
  }
  return chunks;
}

function fencedSegments(text) {
  const lines = text.match(/.*(?:\n|$)/gu) ?? [];
  const segments = [];
  let offset = 0;
  let segmentStart = 0;
  let protectedSegment = false;
  let fence = null;

  function push(end) {
    if (end <= segmentStart) return;
    segments.push({ text: text.slice(segmentStart, end), protected: protectedSegment, start: segmentStart, end });
    segmentStart = end;
  }

  for (const line of lines) {
    const trimmed = line.trimStart();
    const match = /^(?<fence>`{3,}|~{3,})/u.exec(trimmed);
    if (match?.groups?.fence) {
      const token = match.groups.fence[0];
      if (!fence) {
        push(offset);
        protectedSegment = true;
        fence = token;
      } else if (token === fence[0]) {
        const lineEnd = offset + line.length;
        push(lineEnd);
        protectedSegment = false;
        fence = null;
        offset = lineEnd;
        continue;
      }
    }
    offset += line.length;
  }
  push(text.length);
  return segments;
}

export function chunkText(text, { maxCharacters = DEFAULT_MAX_CHARACTERS } = {}) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 128 || maxCharacters > 64_000) {
    throw new Error('maxCharacters must be an integer between 128 and 64000.');
  }
  if (!text) return [];
  const output = [];
  for (const segment of fencedSegments(text)) {
    if (segment.protected || segment.text.length <= maxCharacters) output.push(segment);
    else output.push(...splitPlainSegment(segment.text, segment.start, maxCharacters));
  }
  return output.map((chunk, index) => ({ ...chunk, index }));
}

export function reassembleChunks(chunks) {
  return chunks.map((chunk) => chunk.text).join('');
}
