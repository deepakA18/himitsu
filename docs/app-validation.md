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

## Completed MVP checklist — market swaps v2

The sections above describe earlier milestones. This update supersedes the earlier browser-recovery gap for the current v2 deployment.

- Separate create, unlock, phrase restore and encrypted-backup flows; new wallet creation does not ask users to supply a phrase. Existing vaults are never overwritten.
- Notes, confirmations and transaction status update automatically every three seconds while the page is visible. Failed/uncertain submissions still require explicit retries after reconciliation.
- App readiness verifies the node, deployment, backing, pair configuration/liquidity, tree capacity, fees and paymaster funding. `bun run doctor --app` exposes the same checks. Healthy, unfunded, wrong-chain, wrong-code, stalled-node and wrong-pair cases passed.
- V2 exact-input swaps use live Uniswap reserves and a proof-bound slippage minimum. The full output becomes one amount-bound note, with no public change or intentionally forfeited output. A separate circuit/verifier and deployment preserve v1 compatibility.
- Native forced price movement during proving caused the swap to revert, preserved the input note/accounting and created no output. Explicit retry, phrase-only recovery and exact-value withdrawal passed. Donation-credit rejection, fresh transfer requirements, amount bounds and cleared allowances passed.
- The browser enabled and confirmed a recovery phrase in a disposable legacy fixture, deposited, generated a real v2 swap proof and confirmed automatically. The original vault was locked. A second origin with empty storage restored only the phrase, found the spent WETH note and available gUSD output without the old journal, and proved/confirmed its withdrawal. Reloading the restored vault retained both spent notes and the new journal.
- Browser receipts independently verified an exact output and payout of 157609410164332580779 token units. Evidence: `deployments/app.v2-browser-evidence.json`.
- The transaction panel displayed the actual saved four-frame layout, targets, gas budgets, submission path, paymaster and receipt gas usage.
- Expanded transaction details have no page-level horizontal overflow at 375, 768 or 1280 pixels. Long frame addresses wrap on mobile.
- 62 unit tests / 122 assertions passed, along with root/app TypeScript checks and the optimized Next.js build. Both v1 and v2 native nonce-collision, lost-response, recovery and withdrawal regressions passed. The standalone Playwright suite was updated but not rerun; the browser evidence comes from the in-app browser.

Evidence files: `app.v2-client-evidence.json`, `app.v2-market-evidence.json`, `app.v2-deposit-evidence.json`, `app.v2-browser-evidence.json` and `app.v1-regression-evidence.json` under `deployments/`. Immutable public deployment manifests retain access to older notes across intentional redeployments.

Amounts remain observable and distinctive values can correlate activity. V2 proves exact note value; it does not hide amounts. This remains a local-development system with a development trusted setup, prefunded subsidy and the previously recorded Ethrex patch.

## Portable private-note UI

The main route now uses Deposit / Swap / Withdraw with a required private-note download and explicit backup confirmation before deposit or swap submission. Phrase/password recovery remains at `/legacy`; the original encrypted vault is not migrated or overwritten. Swap inputs are imported from note files, and a fresh output file is saved before proof generation. Per-note encrypted transaction caches unlock from the imported secret without a separate password.

Validation: 66 unit tests / 139 assertions passed, root and app TypeScript checks passed, and the optimized Next.js build includes `/` and `/legacy`. The native `test:private-notes` suite passed against the existing Ethrex deployment using real Groth16 proofs: deposit, fresh-file input import, accepted swap with intentionally lost RPC response, journal reopening using the input file, fresh output-file import and amount recovery, withdrawal, and spent/duplicate-note rejection. Public evidence is `deployments/private-note-evidence.json`.

The new UI has not been visually verified or exercised through browser automation. The user requested no app access and will run it locally. Existing Playwright phrase-flow navigation was moved to `/legacy`; that suite was not run in this milestone. No new contract, circuit, deployment, or Ethrex changes were needed.
