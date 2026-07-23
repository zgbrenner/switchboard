# Switchboard architecture

## Runtime boundaries

Switchboard is a Manifest V3 extension with three browser surfaces:

1. A content module on ChatGPT and Claude captures the unsent draft, bounded recent context, and user-selected files.
2. A service worker persists settings and derived preference weights in `chrome.storage.local`.
3. Popup and options pages expose routing, privacy, and deletion controls.

The current router is synchronous and dependency-light so that the extension remains useful on every supported Chromium browser. Neural model packs will execute in an offscreen document or dedicated worker so model initialization cannot block the page.

## Routing order

1. Detect required capabilities.
2. Apply non-negotiable capability floors.
3. Extract deterministic complexity and task signals.
4. Score abstract route prototypes.
5. Apply local category preferences.
6. Calibrate a four-tier decision.
7. Select a visible provider model through the site adapter.
8. Verify success or fall back to a recommendation.

Provider model names never enter training labels. The router emits abstract tiers and capabilities, while each adapter maps those onto options available to the current account.

## Safety properties

- Explicit user model choices override learned preferences.
- Attached files prevent routing to a non-file-capable tier.
- Visual files and scanned PDFs require vision.
- Large extracted content raises the long-context floor.
- Existing conversations default to recommendation-only mode.
- Adapter failure does not prevent the prompt from being sent.
- No raw prompt or extracted text is sent to the service worker for persistence.
