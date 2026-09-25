# Himitsu

Private Uniswap swaps using proof-authorized native frame transactions and a prefunded, automatic onchain paymaster. Test assets only.

## Current implementation

The supplied implementation is preserved in `packages/protocol`, with import hashes in `docs/import-provenance.json`. The original scratchpad is unchanged. Live circuit artifacts were retained; stale `pot13_*` ceremony files were excluded.

- Bun workspace with pinned dependencies and lockfile.
- EIP-8141 transaction serialization, canonical authorization hash, lossless digest limbs, and rollback-aware frame outcome interpretation.
- Browser-compatible JSON-RPC client, chain/genesis verification, and durable-before-broadcast submission primitive. Ambiguous submissions require reconciliation, never blind reproving/replacement.
- Immutable automatic-paymaster bytecode generator with explicit trusted-pool ABI shapes, fee/gas caps, prefix ordering, prior validation status, no sponsor signatures, and a separate ETH funding path.
- Unit tests for envelope binding, receipt rollback, submission uncertainty, and paymaster policy control flow.

**Not complete:** browser UI/prover, encrypted note persistence, canonical indexer, and contention/reconciliation workflow. The automatic paymaster passes the native private swap, output withdrawal, and failed-swap rollback flow on the locally patched Ethrex client. The imported circuit and lifecycle tests also pass locally. The paymaster test interpreter is deliberately limited: it does not establish EVM gas bounds, admission compatibility, or proof soundness. Never deploy it with real funds.

## Commands

```sh
bun install
bun run check
bun run doctor
```

Use Bun for dependency installation and script orchestration. Protocol scripts run under Node because snarkjs's web-worker dependency crashes under the tested Bun runtime. Node, Circom and Foundry `cast` are required. Solidity artifacts build with pinned solc-js packages, so `forge build` is optional. If a sandbox prevents Bun's default cache/temp access:

```sh
mkdir -p .cache/tmp
TMPDIR="$PWD/.cache/tmp" BUN_INSTALL_CACHE_DIR="$PWD/.cache/bun" bun install
```

Copy `.env.example` to `.env` and set the verified genesis hash before binding a deployment. `doctor` checks RPC identity; it does not prove native opcode execution. The observed local identity is in `deployments/local.observed.json` and must be refreshed after a reset.

The existing node can be started from its checkout without resetting its data:

```sh
cd /Users/deepakagashe/Desktop/ethrex
./target/release/ethrex --dev --network fixtures/genesis/l1-hegota.json --mempool.max-verify-gas 1000000
```

## Version boundary

- Ethrex: `d587cf9ff0996315381c4b2784a4d7d499decc0f`, `frames-devnet-0`.
- EIP encoding/introspection: `ethereum/EIPs@b75cbe6115`.
- The codec intentionally rejects blobs. It performs application-level structural checks, not all consensus/admission checks or cryptographic signature verification.
- There are no claims of ERC-8286 conformance yet. Avoid mixing the draft's evolving interfaces with the pinned client.

## Integrating the existing implementation

The stable integration surface is `packages/protocol/ghost.mjs`; `automatic-sponsor.mjs` adds the generated Himitsu sponsor policy. Historical Ghost names and the Merkle zero-leaf domain are preserved for compatibility. `GhostPoolUnchecked`, the stock verifier, and toy circuits are attack/comparison fixtures, not deployment choices for the app.

```sh
bun run build:protocol
bun run test:circuit
RPC_URL=http://127.0.0.1:8567 bun run test:lifecycle
RPC_URL=http://127.0.0.1:8567 bun run test:automatic
RPC_URL=http://127.0.0.1:8567 bun run test:attack
```

These integration commands deploy contracts and spend local test ETH. Never point them at a real-money chain. Use the existing matching proving key; do not rerun `setup-ceremony.sh` during ordinary builds. The development ceremony is not a production trusted setup.

The pinned Ethrex checkout requires `patches/ethrex-prefix-frame-results.patch` for the automatic sponsor's prior-frame status checks: its original mempool simulator did not populate `frame_results`. Apply to the pinned commit and rebuild before running automatic sponsorship. This local client change is separate from the EIP itself.

`buildPaymaster(policy)` in `packages/contracts/src/paymaster.ts` returns creation code, runtime code, and runtime hash. Supply actual immutable pool addresses, exact verification/execution calldata sizes and selectors, proof length, and measured budgets. Both the input pool and output pool used for withdrawal must be covered. Trusted pools must have pinned, non-upgradeable validation policy or an equivalent explicitly reviewed trust model.

The supported transaction shape is exactly: expiry VERIFY → pool VERIFY (execution) → sponsor VERIFY (payment) → pool SENDER (restricted action). Sponsor calldata is `0x48494d49`. The pool must permit this exact sponsor frame and enforce the entire operation's authorization. Sponsor policy deliberately does not repeat the pairing check or read mutable sponsor storage.

Native validation measured about 233k execution gas for proof validation and 4.7k for sponsorship. The expiry frame needs 5,000 declared gas to cover its cold account access (about 3,051 used); 1,000 can pass the pinned client's simulator but fail block execution. The swap needed about 674k execution and 881k state gas in this fixture. Evidence is written to `.local/evidence/automatic-roundtrip.json`. Next gate: browser integration, durable private notes, chain-event reconstruction, and two-client contention without a signing/coordinator backend.

## Scope and privacy

The team funds test ETH sponsorship; users' notes are not charged gas. Included failed attempts still consume subsidy. A valid note holder can repeatedly burn subsidy; per-transaction limits only bound each attempt. No unlimited top-ups. The imported `depositCredited` also lets anyone claim unaccounted token surplus; harden its funding/credit mechanism before treating arbitrary transfers as protected deposits.

Deposits, withdrawals, AMM trade amounts, and network metadata remain observable. The intended privacy property hides which deposited note authorized an action. Public-network acceptance, reliable concurrency, audit-grade security, and sustainable gas economics are not established.

`docs/implementation-plan-source.md` preserves the supplied GhostSwap-named plan unchanged for provenance. Himitsu is the product name for new implementation.

## Local test node

The current integration run uses a separate devnet at `http://127.0.0.1:8567`, with data in `.local/ethrex-debug`. It does not reset the original Ethrex data. Reproduce it with:

```sh
mkdir -p .local
/Users/deepakagashe/Desktop/ethrex/target/release/ethrex --dev \
  --network /Users/deepakagashe/Desktop/ethrex/fixtures/genesis/l1-hegota.json \
  --datadir "$PWD/.local/ethrex-debug" \
  --authrpc.jwtsecret "$PWD/.local/jwt-debug.hex" \
  --http.port 8567 --authrpc.port 8573 \
  --mempool.max-verify-gas 1000000
```

The initial diagnostic nodes used ports 8547 and 8557 with separate `.local` data directories. Do not start another process against a data directory that is already in use.
