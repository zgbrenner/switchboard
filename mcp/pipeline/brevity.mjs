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
  // An unterminated block (a start marker with no matching end -- truncated content, or a malformed
  // marker) is stale brevity scaffolding, not meaningful reply text. Leaving it in place let a second
  // block get appended alongside the orphaned one on the next call, so drop everything from the
  // start marker to the end of the text rather than only the well-formed start-to-end span.
  const sliceEnd = end < 0 ? text.length : end + BREVITY_MARKER.end.length;
  return `${text.slice(0, start)}${text.slice(sliceEnd)}`.trimEnd();
}

export function appendBrevityInstruction(text, level = 'concise') {
  if (!BREVITY_LEVELS.includes(level)) throw new Error(`Unknown brevity level: ${level}.`);
  const prefix = withoutExistingBlock(text).trimEnd();
  const block = `${BREVITY_MARKER.start}\nReply instruction: ${INSTRUCTIONS[level]}\n${BREVITY_MARKER.end}`;
  return prefix ? `${prefix}\n\n${block}` : block;
}
