# Himitsu app validation — 2026-09-26

## Passed

- Root TypeScript check and 51 unit tests (77 assertions), including encrypted persistence, backup integrity, stale-tab writes, note validation, receipt reorgs, nonce conflicts and browser fetch binding.
- App TypeScript check and optimized Next.js production build.
- Native hardened automatic-sponsor roundtrip: ten checks, including swap, withdrawal and rollback.
- Native surplus regression: donations cannot create notes, legacy credit claims revert, fresh exact deposits succeed, consumed allowances cannot reuse donations, and noncanonical commitments revert.
- Native browser-controller integration with real Groth16 proofs: independent clients collide on a pool nonce; the losing note becomes retryable only after canonical reconciliation. An accepted transaction with a deliberately lost RPC response remains reserved, then recovers its output and withdraws successfully. Public evidence: `deployments/app.client-evidence.json`.
- Actual in-app browser: imported a test vault, generated/funded a local test wallet, deposited, generated the swap proof in the browser worker, submitted directly to Ethrex, reloaded and unlocked the persisted vault, then proved/submitted the output withdrawal. All three journal entries confirmed and both notes became spent.
- Exported the encrypted browser backup and restored it at a separate origin with empty IndexedDB. Both notes and all three confirmed journal entries recovered.
- Responsive widths 375, 768 and 1280 pixels had no horizontal overflow; mobile layout was visually inspected. No browser console errors were observed during the successful proof flow.

The committed Playwright test is available via `bun run test:browser`, but its standalone Chromium process could not launch in this host sandbox (SIGABRT / permission error). It did not pass or execute its workflow here. The browser results above were obtained using the actual in-app browser instead.

## Browser transaction evidence

RPC: http://127.0.0.1:8567, chain 9. Deployment identity is in `deployments/app.local.json`.

- Deposit: `0x28f458d4d6eb481fa884e971a33d252091efc0a39b8ddb3c6e1ba0b556c2b557`
- Swap: `0xa4fe428bb875bfeef345117bb6147176036b44dd8a9045899cf74dd46ae28f6c`
- Withdrawal: `0x1a7c50918442fb42be868926cc67eded74290107f73fd7dccc7ed44490be8022`

These are disposable devnet results, not evidence of public-network admission or production security. The node requires the recorded Ethrex simulator patch. Two-block confirmation is not finality. The test Groth16 ceremony, fixed swap output, pooled nonce contention and sponsor subsidy/griefing remain MVP limitations. Note secrets and wallet keys are excluded from this report.

## Recovery phrase update — 2026-09-26

- 56 unit tests and 101 assertions pass, including the fixed v1 derivation vector and 1,024-slot scan. Root and app TypeScript checks pass.
- Optimized Next.js build passes with recovery support.
- Real Ethrex integration recovered notes at counters 32 and 64 from only the phrase, into empty storage using a different local password, then withdrew the recovered swap output. No draft notes, old journal, or test wallet key were imported. Nonce collision and lost-response tests also passed in this run. Evidence: `deployments/app.recovery-evidence.json`.
- The actual in-app browser unlocked the existing legacy fixture, synchronized both spent notes and retained all journal entries, and displayed the legacy-backup warning and recovery setup entry point. Phrase creation/restore was verified through native client tests; the new phrase UI was not exercised end to end in a browser this run. The maintained Playwright workflow includes phrase confirmation but was not rerun due to the previously recorded host launch limitation.
