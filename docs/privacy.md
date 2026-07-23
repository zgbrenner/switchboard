# Privacy and threat model

## Data processed

Switchboard may temporarily process:

- The current unsent draft
- Up to four recent conversation turns when enabled
- User-selected attachment bytes and bounded extracted text
- Visible model-picker labels

All processing occurs in the browser. Temporary prompt and file data remains in the content module and is released after routing.

## Data persisted

Only these values are stored:

- Extension settings
- Small numeric category adjustments derived from user overrides

The persisted record contains no prompt, file excerpt, assistant response, page title, URL path, or browser history.

## Permissions

- `storage`
- `https://chatgpt.com/*`
- `https://claude.ai/*`

Switchboard does not request tabs, history, cookies, identity, downloads, clipboard, native messaging, or broad web access.

## Threats and controls

| Threat | Control |
|---|---|
| Prompt leakage | No server, telemetry, or remote inference |
| Malicious archive | Central-directory bounds, ratio limits, path checks, entry limits |
| Misleading extension | MIME and magic-byte cross-checking |
| Supply-chain model replacement | Immutable revision and per-asset SHA-256 requirements |
| Catastrophic site-adapter failure | Safe recommendation fallback and unblocked send |
| Silent model changes | Visible panel and manual tier controls |
| Excessive persisted context | Derived numeric preferences only and one-click deletion |
| Remote-code policy violation | All executable assets are packaged and verified during build |
