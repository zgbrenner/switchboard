export const BREVITY_LEVELS = Object.freeze(['brief', 'concise', 'minimal']);

export const BREVITY_MARKER = Object.freeze({
  start: '<!-- switchboard:brevity:start -->',
  end: '<!-- switchboard:brevity:end -->',
});

const INSTRUCTIONS = Object.freeze({
  brief: 'Keep the answer brief. State the result first, include only the reasoning needed to trust it, and do not restate the request.',
  concise: 'Answer concisely. Put the direct answer first, use compact paragraphs, and omit ceremony, repetition, and unnecessary detail.',
  minimal: 'Use the fewest words that preserve correctness. Give only the answer, required steps, and essential caveats.',
});

function withoutExistingBlock(text) {
  const start = text.indexOf(BREVITY_MARKER.start);
  if (start < 0) return text;
  const end = text.indexOf(BREVITY_MARKER.end, start + BREVITY_MARKER.start.length);
  if (end < 0) return text;
  return `${text.slice(0, start)}${text.slice(end + BREVITY_MARKER.end.length)}`.trimEnd();
}

export function appendBrevityInstruction(text, level = 'concise') {
  if (!BREVITY_LEVELS.includes(level)) throw new Error(`Unknown brevity level: ${level}.`);
  const prefix = withoutExistingBlock(text).trimEnd();
  const block = `${BREVITY_MARKER.start}\nReply instruction: ${INSTRUCTIONS[level]}\n${BREVITY_MARKER.end}`;
  return prefix ? `${prefix}\n\n${block}` : block;
}
