# Himitsu

Private Uniswap swaps using proof-authorized native frame transactions and a prefunded, automatic onchain paymaster. Test assets only.

## Current implementation

The supplied implementation is preserved in `packages/protocol`, with import hashes in `docs/import-provenance.json`. The original scratchpad is unchanged. Live circuit artifacts were retained; stale `pot13_*` ceremony files were excluded.

- Bun workspace with pinned dependencies and lockfile.
- EIP-8141 transaction serialization, canonical authorization hash, lossless digest limbs, and rollback-aware frame outcome interpretation.
- Browser-compatible JSON-RPC client, chain/genesis verification, and durable-before-broadcast submission primitive. Ambiguous submissions require reconciliation, never blind reproving/replacement.
- Immutable automatic-paymaster bytecode generator with explicit trusted-pool ABI shapes, fee/gas caps, prefix ordering, prior validation status, no sponsor signatures, and a separate ETH funding path.
- Unit tests for envelope binding, receipt rollback, submission uncertainty, and paymaster policy control flow.

**Implemented for local testing:** Next.js UI, browser Groth16 proving, portable private-note files with encrypted per-note IndexedDB transaction caches, canonical event reconstruction, and shared-pool nonce reconciliation. The automatic paymaster passes the native private swap, output withdrawal, and failed-swap rollback flow on the locally patched Ethrex client. The imported circuit and lifecycle tests also pass locally. The paymaster test interpreter is deliberately limited: it does not establish EVM gas bounds, admission compatibility, or proof soundness. Never deploy it with real funds.

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

## Basic testing app

The latest app defaults to **Market swaps · v2**, with live Uniswap quotes, slippage limits and the full swap output in one amount-bound private note. Use the deployment selector for original fixed-size v1 notes. See `docs/market-swaps-v2.md` for accounting, recovery, privacy limits and validation.


`app/` contains a minimal Next.js interface. Proofs run in a browser worker with the existing Circom circuit and Groth16 key. The browser submits frame transactions directly to RPC; there is no signing server, relayer, or bundler. The prefunded contract pays gas.

From the repository root, with the patched local node running:

```sh
bun install
# First setup, or after a contract change / chain reset:
RPC_URL=http://127.0.0.1:8567 bun run deploy:app
# Ordinary app startup; reuse the existing deployment:
bun run dev
```

Open http://127.0.0.1:3000. `deploy:app` writes `deployments/app.local.json`, the public deployment manifest, and browser proving assets. It deploys test pools, liquidity and a sponsor funded with 0.1 test ETH. Do not redeploy on every app start: old notes are bound to their original deployment. The manifest pins chain ID, genesis, a postdeployment anchor block, contract runtime hashes, and proving-asset hashes.

1. **Deposit:** connect a wallet through Family ConnectKit on chain 9, choose **Create deposit note**, download the private note, and confirm that you saved it. Only then approve the ETH deposit in your wallet. No phrase or local password is required.
2. **Swap:** paste/import the WETH note, review the live quote and slippage, then download and confirm a **new output note before submission**. The entire actual gUSD output becomes that note. Retain the input note until confirmation; a failed swap leaves it unspent.
3. **Withdraw:** paste/import an unspent input or output note and enter the recipient. The full note amount is withdrawn; WETH notes pay WETH, not native ETH. No connected wallet is required to authorize a private spend.
The pool selector is under **Pool details & network status**. The app supports private-note files only; the legacy phrase-recovery page has been removed.

Each downloaded file is an **unencrypted bearer secret**. Anyone holding it can spend its note. Save a new file for every deposit and swap output; there is no master recovery phrase for these random notes. A pre-swap output file contains the recovery tag preimage; its exact amount is reconstructed and verified against canonical pool events. Notes are bound to chain ID, genesis, immutable deployment identity, pool, and circuit version. Imported files cannot choose the RPC endpoint.

The browser keeps AES-GCM encrypted per-note transaction records. The supplied note derives the cache key, so there is no separate password. Secrets are not stored in plaintext in browser storage. The raw signed transaction is saved before broadcast, and re-importing the source note in the same browser recovers pending history. Browser cleanup removes this journal; the file still recovers confirmed note ownership on a fresh device. Use one active browser per note and do not retry an uncertain submission from another device. Keep both source and output files until confirmation. Encrypted storage does not protect an open page from malicious scripts.

See `docs/private-notes.md` for the format and flow, and run `bun run test:private-notes` for the real devnet note-file round trip. This uses the existing deployment; do not redeploy to test the UI.

### Wallet connections (Family ConnectKit)

The deposit button uses ConnectKit 1.9.1, Wagmi 2.15.6 and TanStack Query. The custom chain and RPC come from the public deployment manifest. Injected browser wallets work without an API key; the button also opens account/disconnect controls. A wrong-network connection exposes **Switch to Himitsu devnet**. Account, connector and network changes are checked again before wallet requests. Private-note swaps and withdrawals do not request wallet signatures.

To enable WalletConnect QR/mobile connections, create `app/.env.local` using `app/.env.example` and set:

```dotenv
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

Obtain a project ID through the service linked in [Family's ConnectKit setup guide](https://family.co/docs/connectkit/getting-started), then restart `bun run dev`. The ID is public client configuration. No placeholder project ID is shipped. Mobile wallets cannot reach the laptop's loopback RPC: use a devnet endpoint reachable by the wallet before testing mobile connections. WalletConnect transports deposit-wallet requests only; private frame transactions still go directly from the browser to the deployment RPC.

ConnectKit's declared React peer range is 17/18, while this app uses React 19.3.0. Build/type checks do not establish modal runtime compatibility; actual wallet connection, switching, disconnect and deposit approval remain part of the user's local browser verification. Wagmi 2.15.6 is pinned because the newer 2.19.5 connector bundle pulled in unresolved Coinbase x402 modules during the Next build.

Reconciliation rebuilds trees from canonical deposit events and checks nullifiers, pool nonces and receipts at a consistent block. Two-block confirmation is a devnet policy, not finality. Unknown broadcasts reserve the input note until chain evidence resolves them. Nonce conflicts release only unspent notes for an explicit retry; no automatic reproving or replacement occurs. A later reorg reopens cached outcomes for reconciliation.

The original v1 fixed quote leaves excess AMM output in the pair. V2 replaces that path with exact-input market swaps and full-output private notes; it enforces slippage atomically. The UI is intentionally basic. `bun run build:app` produces a production build; `bun run --cwd app start` serves it. Development mode uses polling to avoid host file-watcher limits.

Validation commands (integration commands spend only local test assets):

```sh
bun run check
bun run typecheck:app
bun run build:app
RPC_URL=http://127.0.0.1:8567 bun run test:surplus
bun run test:client
bun run test:market
# With the app running and a usable Playwright Chromium installation:
```

`test:client` is a historical client-library regression suite, not the current UI workflow. It reads the existing app deployment. It exercises two independent vaults, a real nonce collision, an accepted transaction with a lost response, phrase-only restoration with a new password across counter gaps, output recovery, and withdrawal. Full browser testing and host limitations are recorded in `docs/app-validation.md`.

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

Native validation measured about 233k execution gas for proof validation and 4.7k for sponsorship. The expiry frame needs 5,000 declared gas to cover its cold account access (about 3,051 used); 1,000 can pass the pinned client's simulator but fail block execution. The hardened swap needed about 714k execution and 881k state gas in this fixture. Evidence is written to `.local/evidence/automatic-roundtrip.json`. The app and two-client reconciliation validation are documented in `docs/app-validation.md`.

## Scope and privacy

The team funds test ETH sponsorship; users' notes are not charged gas. Included failed attempts still consume subsidy. A valid note holder can repeatedly burn subsidy; per-transaction limits only bound each attempt. No unlimited top-ups. The legacy `depositCredited` entry point now always reverts. Token notes require a fresh, exact `transferFrom`; unsolicited donations remain unaccounted and cannot be claimed as notes. Swap output is received and measured by the input pool, then atomically deposited into the output pool using an exact allowance that is cleared afterwards. Deposit and spend entry points use a transient reentrancy guard; noncanonical commitments are rejected.

Deposits, withdrawals, AMM trade amounts, and network metadata remain observable. The intended privacy property hides which deposited note authorized an action. Public-network acceptance, audit-grade security, and sustainable gas economics are not established. Independent-client nonce contention is tested, but competing users still share a pool nonce and may need explicit retries.

`docs/implementation-plan-source.md` preserves the supplied original plan unchanged for provenance. Himitsu is the product name for the implementation.

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
