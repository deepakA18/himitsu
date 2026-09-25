# Himitsu local native validation — 2026-09-25

The imported implementation lives in `packages/protocol`. Import-time hashes are in `import-provenance.json`; subsequent integration changes intentionally differ from those hashes. The scratchpad was left untouched and the stale pot13 ceremony files were excluded.

## Verified

- Bun typecheck and 39 unit tests passed, including agreement between independent RLP/digest codecs.
- Real Circom membership proof succeeds; modified recipient, root and either transaction-digest limb fail; a nonmember cannot generate a proof.
- snarkjs verified the live zkey against the R1CS and `pot_final.ptau` (`ZKey Ok!`). This establishes consistency, not ceremony trustworthiness.
- Seven lifecycle checks passed: valid spend, proof corruption, recipient mutation, repeat nullifier, extra execution frame, sponsorship, and rejection of the stock verifier's banned GAS opcode.
- Four layout-attack checks passed, including an exploit reproduced against the intentionally unchecked fixture and rejection against the checked pool.
- All ten automatic round-trip checks passed. The prefunded sponsor paid for the swap, output-note withdrawal, and reverted swap. Pool ETH balances stayed zero. Each transaction carried one ARBITRARY proof and no sponsor signature. Invalid proofs and gas budgets beyond policy were refused. Sponsor balance loss exactly equaled receipt gas fees.

Public addresses, receipts, fee totals, chain identity and policy are in `deployments/local.native-evidence.json`. No note secrets are included. These are historical local-run results; check current bytecode and genesis before reusing addresses.

## Client fix

The pinned Ethrex mempool simulator did not append prefix results to `FrameTxContext.frame_results`. Reading an earlier status with FRAMEPARAM therefore failed admission, despite working in full execution. `patches/ethrex-prefix-frame-results.patch` records those results; the Desktop Ethrex checkout was patched and its release binary rebuilt successfully. The successful automatic run is the end-to-end regression for this failure. It is not an upstream fix or a claim about other clients.

A second discrepancy remains in the client: prefix simulation omits frame-entry access charges. A 1,000-gas expiry frame was admitted but evicted during block building. Himitsu now budgets 5,000; actual expiry usage was 3,051. Sponsor policy checks remain intact.

## Boundaries

Bun manages dependencies and script orchestration; Node runs snarkjs because its workers crashed under Bun. Solidity builds use pinned solc-js (0.8.30 for pools, 0.5.16 for official Uniswap v2).

This is a backend integration milestone, not the completed MVP. Browser proving, encrypted note persistence/export, canonical event reconstruction, and shared-sender nonce reconciliation remain. The imported public surplus-credit mechanism needs hardening; the development ceremony and sponsored-failure economics also preclude production claims. There is no assertion of EIP-8286 conformance or public-network mempool compatibility.
