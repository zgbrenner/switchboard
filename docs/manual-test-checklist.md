# Manual browser test checklist

Run these checks in a clean Chromium profile after `npm run build` and loading `dist/` as an unpacked extension.

## General

- Popup opens and settings survive a browser restart.
- Disabling Switchboard leaves ChatGPT and Claude send behavior untouched.
- The options page deletes settings and learned category weights.
- No request appears in DevTools Network that originates from Switchboard.

## ChatGPT

- A simple rewrite recommends or chooses a fast option.
- A deep research prompt recommends or chooses the strongest research/reasoning option.
- Enter and the visible send button each trigger routing exactly once.
- An existing conversation remains recommendation-only with the default setting.
- If the model picker cannot be found, the prompt still sends and the panel reports a safe fallback.

## Claude

- A simple rewrite prefers Haiku when available.
- A normal analytical request prefers Sonnet.
- A difficult high-stakes request prefers Opus or the strongest visible reasoning option.
- Existing-conversation protection and adapter fallback behave as they do on ChatGPT.

## Files

- TXT, Markdown, HTML, JSON, and CSV attachments contribute local text.
- DOCX, PPTX, and XLSX attachments contribute bounded Open XML text.
- A scanned PDF requires vision rather than being treated as empty.
- A binary file renamed to `.pdf` is flagged as an extension mismatch.
- An oversized file produces a local warning without freezing the page.
