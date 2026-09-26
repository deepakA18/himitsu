# Himitsu adversarial compatibility audit — 2026-09-27

## Verdict

The active deployed private-note swap/withdrawal flow works on the patched local Ethrex frame devnet without an offchain relayer or bundler. **The repository is not currently reproducible as a clean V2 deployment:** its proving key and source verifier disagree, and its active deployment predates the current pool source. Do not treat passing deployment integrity checks as proof of source equivalence or complete EIP conformance.

Scope: application submission and proving paths, frame codec, privacy pools, validator assembly, generated paymaster policy, deployment artifacts, circuit/key consistency, and Ethrex validation/execution integration. This is a targeted code review and adversarial test run, not a formal cryptographic audit or exhaustive Ethereum conformance suite. No application source, deployment manifest, or proving assets were changed during this audit.

Himitsu HEAD: `c222817aa4794ff562f4bd38043a16f1ce1e846e` plus existing uncommitted UI changes. Ethrex HEAD: `d587cf9ff0996315381c4b2784a4d7d499decc0f`, `frames-devnet-0`, with the local validation-prefix result patch. RPC: local chain ID 9.

## Findings

### High — V2 proving key and source verifier do not match

`packages/protocol/circuits/v2/spend-v2.zkey` derives a verification key whose `vk_delta_2` differs from `circuits/v2/verification_key.json` and the constants at `contracts/src/SpendVerifierV2.sol:40–43`. The compiled verifier artifact matches that mismatched Solidity source. The public application proving key is identical to the protocol proving key.

Reproduction: generate one valid synthetic V2 witness/proof. Verification with the checked-in JSON returns **false**; verification with the key exported from the zkey returns **true**. A fresh disposable deployment from current artifacts also stops at the bidirectional test's local proof check before the first swap broadcast.

Crucial distinction: the active onchain verifier, `0xd2a25a4b1ff7195730670272866e217ed3d1511e`, accepts the same proof. It differs from the current source artifact. Thus this is a broken rebuild/redeployment path, not evidence that the existing deployed verifier rejects its app's proofs. The application worker generates proofs without checking the mismatched JSON locally.

Required fix: select one complete ceremony output set; regenerate the JSON verification key and patched Solidity verifier from that exact zkey; compile; verify an actual proof locally and onchain; deploy and publish one consistent manifest. Add a build check that compares the exported verification key and validates a proof. Do not independently regenerate just one member of the set.

### High — current pool source and active deployment differ

The active WETH pool `0x2a65aaa7033c8c99658e0dad9c1ba7d0db9c3389` and hUSD pool `0x58f07c1dcd4c8bdde15288d3df14aedc20e26a0d` each have 10,167 runtime bytes; current compiled `HimitsuPoolV2` has 11,748. They differ even after immutable offsets are excluded. Current compiled artifacts match the current source, so this is deployment drift.

The current client/source includes `spendAndSwapToRecipient` for direct swap-and-withdraw, whereas the deployed pool is an earlier revision. The direct swap selector is absent from the deployed bytecode. In the live audit run, direct swap-and-withdraw remained `unknown` with no canonical receipt and the test timed out (transaction `0x53467f5b4fbfd543483a9b7ad47888a5b43a0d0ced6af8e21071a400a1fce546`). Existing note-to-note swaps and normal withdrawals passing cannot establish support for that newer action. This timeout alone does not prove which validation stage rejected the transaction. Deployment integrity checks pin the manifest's code hashes; they do not establish that those hashes represent the current source.

Required fix: after correcting the verifier bundle, redeploy a consistent pool/validator/paymaster bundle and update the manifest. Preserve access to existing deployment notes. Gate UI actions by verified deployment capabilities and compare build/runtime hashes in release checks.

### Medium — Ethrex validation-prefix gas accounting differs from execution

`crates/vm/levm/src/vm.rs` full execution computes frame-entry target/delegation access charges. `simulate_validation_prefix` discards `_access_cost` at approximately line 3062 and creates the child call with the full `frame.gas_limit` at approximately line 3117.

This leaves a mempool-admission versus execution discrepancy for tight gas budgets. The repository documents the low-budget expiry-frame reproduction in `docs/native-validation.md`; this audit confirmed the source discrepancy, but did not freshly reproduce that specific low-budget transaction. Himitsu uses a 5,000-gas expiry budget and its tested flows succeed. The local prefix-result patch addresses a different issue: later verification frames need the earlier frames' results. It does not eliminate this gas-accounting discrepancy.

Required fix: align simulation and execution entry charging and regression-test the boundary. Do not describe the node as fully EIP-conformant based solely on Himitsu flow tests.

### Limitation — shared sender nonce remains a contention point

The pool is the frame transaction sender. The client checks its nonce before proving and again before broadcast (`app/src/lib/controller.ts`, around lines 344 and 470). Another user can consume that shared nonce, forcing regeneration/retry. This is not a relayer dependency, but it does not solve independent nullifier-keyed/2D nonce concurrency. Client locks do not coordinate unrelated devices/users.

## Compatibility and submission review

- The frame codec pins EIP revision `b75cbe6115`, matching the current EIP revision checked during this audit. Type `0x06`, frame modes, signature entries, and execution/state budgets align with this frame-devnet integration.
- Pool validation checks the root, nullifier, sanctioned layout and permitted execution selector. The validator uses frame/signature introspection, verifies the proof, and approves execution in the pool's context. Settlement checks the preceding successful verification and consumes the nullifier.
- Public proof inputs bind the note amount, recipient and transaction digest. Replay protection combines the spent nullifier with the sender nonce. Swap settlement and note consumption revert together on slippage failure.
- The client puts proof bytes in an ARBITRARY signature entry and submits with `eth_sendRawTransaction` directly (`app/src/lib/controller.ts:520`). No `eth_sendUserOperation`, bundler endpoint, offchain sponsor authorization request or relay submission service was found in the active path.
- The onchain paymaster validates permitted pools, frame layout, prior approvals, selectors, proof size and gas/fee bounds, then approves payment. It requires funding, not a per-transaction operator signature. Deposits still use the connected wallet and user-paid gas.
- WalletConnect/ConnectKit connection transport is distinct from a transaction relayer/bundler. RPC infrastructure still sees submissions and is required for network access.
- The pool transfers exact swap input to the Uniswap V2 pair. Tests verify no remaining exchange allowances; an exact temporary allowance between privacy pools is cleared after settlement. Avoid claiming that no allowance exists anywhere internally.

## Tests and evidence

- `bun run check`: typecheck and 76 tests / 201 assertions passed.
- `bun run doctor --app`: deployment hash/genesis/readiness checks passed. These checks did not catch the source/key drift above.
- `packages/protocol/attack.mjs`: 4 checks passed, including a demonstrably drainable unchecked fixture and rejection by the checked fixture.
- `lifecycle.mjs`: 7 checks passed, including corrupted proof, changed recipient, replay/double-spend and prohibited verifier behavior.
- `automatic-roundtrip.mjs`: 10 checks passed, including atomic rollback, sponsor bounds and sponsor payment without a sponsor signature.
- Those three protocol suites exercise legacy fixtures; they do not certify the current V2 source.
- Fresh V2 deployment: failed the stored-key local proof check, as described above.
- Active deployed V2: an audit copy of `test-bidirectional.ts`, using the verification key derived from the shipped zkey solely for its local assertion, passed forward swap, lost-response journal reconciliation, fresh-file output recovery, reverse slippage rollback, reverse swap, zero residual allowances, reswap of variable WETH, and exact hUSD withdrawal. This audit adaptation is not a fix to repository artifacts.

Audit scripts and derived key are under ignored `.local/audit-*`; detailed logs are `/tmp/himitsu-audit-*.log`. Local test transactions were mined, disposable contracts deployed, and the active test pair's reserves changed as part of the slippage test. No Vercel or public-network deployment was changed.

References: [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141), [Ethrex](https://github.com/lambdaclass/ethrex). Compatibility statements above refer to this inspected revision and tested node, not guaranteed future EIP behavior.
