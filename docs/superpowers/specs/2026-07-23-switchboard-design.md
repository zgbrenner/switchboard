# Switchboard design

Switchboard is a local-only Chromium extension for ChatGPT and Claude. It intercepts an unsent draft, optionally reads bounded recent context, inspects user-selected files, determines required capabilities, routes to an abstract quality tier, and selects the strongest appropriate visible model without transmitting routing data to another service.

The system is split into independent routing, file-inspection, model-pack, provider-adapter, persistence, and UI units. The deterministic router and browser-native file pipeline are always available. Neural Scout, Arbiter, and Judge packs are optional enhancements gated by browser benchmarks and immutable asset verification.

The extension must fail safely when provider interfaces change, preserve explicit user choices, avoid persisting raw content, request only storage and provider host permissions, and make every automatic selection visible and reversible.
