# Bug records

## 2026-08-16: Custom-domain verification timed out before DNS propagation

- **Symptom:** A newly attached Cloudflare Workers Custom Domain could remain
  unreachable after the prior 92-second verification window elapsed.
- **Root cause:** Cloudflare had accepted the binding and created its managed
  DNS record, but authoritative DNS publication completed after that window.
- **Fix:** Extend the default retry window to roughly five minutes and report
  each retry's failure reason and next delay.
- **Verification:** Unit tests, TypeScript check, build, public Node `fetch`,
  and a resumed project setup all completed successfully.
