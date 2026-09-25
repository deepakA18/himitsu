# Market swaps v2

V2 is a separate local deployment. V1 contracts, circuit, proving key and deployment remain available through the app's deployment selector. V1 notes do not migrate automatically. Do not reset the devnet to upgrade.

## Value accounting

A v2 note commits to `Poseidon(Poseidon(nullifier, secret), amount)`. The inner commitment is a recovery tag. Each pool rejects reuse of a tag, including reuse with a different amount. Amounts must be nonzero and fit in 128 bits. WETH deposits remain fixed at 0.1 ETH; the gUSD output pool supports variable values.

The v2 circuit proves membership, nullifier ownership, exact note amount and the full transaction digest. Circom's actual public order (from the generated `.sym`) is root, nullifierHash, recipient, amount, txHashHi, txHashLo. The amount-bound frame validator follows this order. A separate development key/verifier is required. The old five-signal verifier is unchanged.

`spendAndSwapQuoted(pair, minOut, outputPool, recoveryTag)` spends the entire input note. In the atomic execution call it checks the pair tokens, reads the live V2 reserves, computes exact-input output with the 997/1000 fee formula, enforces the proof-bound minimum, swaps, checks the exact received balance delta, and deposits the full output into the output pool. Any price improvement is included in the note; no separate change, public refund or intentionally forfeited surplus is needed. Fresh transferFrom and cleared exact allowances preserve donation-credit hardening. Any failure rolls back settlement and output creation; included failures still cost the paymaster gas.

The browser displays a live quote and 0.1%, 0.5% or 1% slippage. Quotes older than 30 seconds are rejected before proving. Slippage is enforced again by the contract at execution. Readiness checks verify deployment identity/runtime hashes, pair tokens, reserves, pool token/denomination configuration, backing balances, tree capacity, fee caps and conservative paymaster funding. They do not reserve funds or promise inclusion.

## Recovery

The phrase/counter derivation stays v1: deployment identity already separates v1/v2 notes. For v2 the scanner matches derived recovery tags locally to DepositV2 events, validates each event's amount commitment, rebuilds the canonical tree, and checks matched nullifiers. Pending swap output secrets are saved before proving; the actual amount is learned from the confirmed event. A reorg can change an output's amount, so matching uses the stable recovery tag rather than a guessed quote. The existing 1,024-slot full scan and one-active-browser guidance remain.

## Privacy scope

Amounts and recovery tags are public deposit-event data. The proof does not reveal the selected leaf, but a distinctive amount can identify a plausible matching deposit when it is spent; timing and public AMM activity also correlate flows. V2 keeps custody and spend authorization in private notes; it is not an amount-hiding circuit or protection from amount analysis. The local trusted setup, shared pool nonce, prefunded sponsor and patched Ethrex remain MVP limitations.

## Reproduce

Use Bun for orchestration and Node for snarkjs. Existing v2 artifacts are checked in the workspace; do not rerun setup during normal app startup.

- `bun run setup:v2`: explicit separate local development ceremony, using the retained phase-1 powers of tau. Preserves v1 artifacts.
- `RPC_URL=http://127.0.0.1:8567 bun run deploy:app:v2`: deploy new pools, official Uniswap V2 liquidity, automatic sponsor and public manifest. Use only for an intentional new deployment.
- `bun run test:client`: real proof amount-binding check, nonce collision, accepted transaction with lost response, phrase-only recovery across counter gaps and exact withdrawal.
- `bun run test:market`: move AMM price after proving, assert slippage revert/input preservation/no output, explicitly retry, recover the exact full output and withdraw it. Also checks zero-paymaster-balance gating by read-only fault injection.

Evidence is preserved in `deployments/app.v2-client-evidence.json` and `deployments/app.v2-market-evidence.json`. The first v2 integration attempt caught incorrect public-signal ordering in the adapter; the adapter was fixed and the successful tests use the deployment identified by those evidence files.
