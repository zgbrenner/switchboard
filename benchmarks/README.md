# Router benchmark

`router-cases.jsonl` is the checked-in smoke-test suite for routing safety. Each case defines an acceptable tier range and mandatory capabilities.

Run:

```bash
npm run benchmark
npm run benchmark -- --strict
```

Strict mode fails when any case is routed below its minimum tier or misses a required capability. Over-routing is reported separately because it wastes premium usage but is not treated as equivalent to harmful under-routing.

The current corpus is intentionally small and human-readable. It should grow through reviewed boundary cases, real local override patterns stripped of raw user text, multilingual examples, and adversarial tests. It is not a substitute for a locked production evaluation set.
