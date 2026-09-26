# Himitsu — private swaps, zero exchange approvals

Phased implementation plan · researched September 20, 2026 · updated September 25, 2026 — free prefunded paymaster and direct browser submission

**Product:** Trade from a private balance without giving an exchange an allowance. The public transaction originates from a shared privacy account. A zero-knowledge proof authorizes one specific action; the exchange receives only that action's input.

**First complete journey:** Deposit native test ETH → receive a private WETH note → swap part of it into private demo USDC → optionally swap back → withdraw to a chosen address. All balances are test assets. Deposits, withdrawals, and public AMM trade amounts remain observable; the privacy objective is to conceal which deposited note authorized a trade.

The user reports a complete WETH note → official Uniswap v2 pair → private gUSD note → separate withdrawal lifecycle, plus malicious-layout rejection and failed-swap rollback. The latest circuit uses two range-constrained 128-bit digest limbs; the development ceremony now uses cryptographic randomness but remains a single-contributor setup. These are user-reported results, not independently reproduced here. The automatic, signature-free paymaster described below is the next implementation milestone; earlier sponsored tests do not establish that this new policy is implemented.

## Decision — free sponsorship for the MVP

Accepted September 25, 2026: fund a separate `GasSponsor` paymaster contract with test ETH and sponsor supported private swaps and withdrawals for free. Gas is not deducted from users' notes. Keep paymaster ETH separate from WETH/token assets backing those notes.

- **No per-transaction sponsor signature or approval API.** The paymaster approves payment through deterministic onchain policy after the trusted pool has approved execution. Its funding wallet is not a runtime transaction signer.
- **No mandatory nonce coordinator.** Browsers read chain/pending state, prove locally, and submit raw native transactions directly. On contention they wait, refresh, and reprove with the new nonce. Reading a nonce is not reserving it.
- **Optional relay only.** An HTTP relay may forward already-built bytes when transport needs it; it has no signing key, nonce authority, or exclusive submission permission. Direct RPC remains a supported path.
- **Free means subsidized.** The paymaster pays for successful and failed included transactions. Per-transaction caps and a limited prefunded balance bound exposure; they do not prevent a valid note holder repeatedly spending the subsidy on failed swaps. Accept this demo limitation explicitly. No reimbursement, fee-note circuit, or sustainable fee model is required for this MVP.
- **Concurrency is unchanged.** The shared sender and this fork's noncanonical paymaster each retain their pending-transaction restrictions. Browser retries remove a mandatory backend dependency, not those limits or fairness issues.

**Next milestone:** implement and test the automatic paymaster policy with the existing proof-authorized pool, then demonstrate two browser profiles completing swaps with the sponsor/coordinator backend stopped. No implementation completion is implied by this plan update.

## Current progress — integrate automatic sponsorship and the browser flow

| Milestone | Status | Evidence or next gate |
| --- | --- | --- |
| Phase 0A — local node startup | **Complete** | User reports successful startup; screenshot shows `Produced block`, block 13 with zero transactions, and the `frames-devnet-0` branch |
| Phase 0B — RPC identity and first native frame | **Passed in the user-reported run** | Local chain 9, blocks advancing, deployed contract sender, successful VERIFY + SENDER in block 56; full hashes and receipt still need archiving |
| Phase 0C — Groth16 execution, binding, and sponsorship compatibility | **Passed in reported spike and real-circuit runs** | A–E repeated by lifecycle.mjs; final gas profile and production-grade authorization remain separate gates |
| Phase 1 — exchange infrastructure | **Official deployment reported passing** | Official Factory creates Pair via CREATE2; deployed runtime checked against compiled artifacts; approval-free swap retained |
| Phase 2 — private deposit and spend lifecycle | **Functional gate passed in reported tests** | Layout restrictions, digest limbs, and random development ceremony reported implemented; preserve regressions |
| Phase 3 — automatic free paymaster | **Decision accepted; implementation pending** | Prefunded separate contract, immutable sponsorship policy, no service signature; validate full prefix on pinned node |
| Phase 4 — complete private swap | **Round trip reported passing** | WETH note → private gUSD note → separate proof and withdrawal; failed swap rolls back |
| Phases 5–7 — app, verification, and submission | Pending | Finish browser proving, services, failure tests, stage demo, and bounty evidence |
| Public Frames deployment | Separate, pending | Demonstrate actual acceptance on chain 81410 after the local native proof succeeds |

**Current development configuration:** `--mempool.max-verify-gas 1000000`. The user reports successful real-pairing validation at this setting and rejection of the identical valid transaction at the default 100,000 setting. Keep declared prefix budgets separate from measured execution gas; 1,000,000 is the working configuration, not a demonstrated minimum. The initial screenshot's `gas_ceil=25000000` is the block gas ceiling, a different setting.

**Resume here:** Preserve lifecycle.mjs, attack.mjs, roundtrip.mjs, and swap.mjs. Implement the free onchain paymaster policy in Phase 3 and direct browser submission in Phase 5. Retain the shared-pool sender. Measure the complete new prefix and both gas dimensions before later public-budget tests. Fixed-output surplus and unattributed deposit credit remain separate accounting work; this sponsorship decision does not resolve them.

### Latest reported implementation updates

- `_requireSanctionedLayout()` rejects extra or unrelated execution; the product uses one SENDER call into the pool. The unchecked regression demonstrates the former drain and the guarded variant rejects it.
- Verification-frame discovery supports a leading expiry frame. Preserve exactly one pool verification frame and add the narrowly specified paymaster VERIFY frame without weakening execution restrictions.
- `roundtrip.mjs` reports a private output note spent from a different pool in a later transaction, plus rollback on failed swaps. Official Uniswap v2 replaces the earlier port.
- The circuit has 6,391 constraints and two range-constrained 128-bit digest limbs. Setup uses `openssl rand -hex 64` and `snarkjs zkey verify`; one contributor remains a development trust assumption.
- Execution and state gas must be sized separately. The official pair was reported to succeed at 96,664 execution / 293,760 state gas; state-gas exhaustion can instead show full execution consumption and zero state gas in the failed receipt.
- Fixed 150 gUSD output notes currently forgo surplus relative to the available quote; `depositCredited` also needs attributable credit accounting. Preserve these as known product/accounting limitations, not sponsorship prerequisites to silently mark complete.

### Historical lifecycle and swap evidence — September 22

The following table records the earlier milestone. The updates above supersede its port, setup, digest, and private-output limitations.

| Area | User-reported result |
| --- | --- |
| Circuit | Poseidon commitment/nullifier, depth-10 membership, 6,134 constraints; signals `[root, nullifierHash, recipient, txHash]`; approximately 347 ms proving in the tested environment |
| Deposit | Fixed 0.1 ETH → WETH → note; 840,690 gas including ten on-chain Poseidon hashes; JS/on-chain roots cross-checked after each insert |
| Valid withdrawal | Recipient received exactly 0.1 WETH |
| Invalid attempts | Corrupted proof, recipient mutation, and later-transaction double spend rejected at admission |
| Same-transaction double spend | Second spend failed during execution; paid once. Do not conflate this with all-or-nothing rollback unless the spends were in one atomic group |
| Sponsorship/verifier | Sponsor paid gas, pool ETH unchanged; stock generated snarkjs verifier rejected with BannedOpcode(90) |
| Plain swap | 197.431607 gUSD output; allowance zero before and after |
| Note-funded swap | 193.566092 gUSD output in one transaction; output-note creation and later private spend are not established by this result |
| Failed swap | Nullifier remained unspent; pool WETH unchanged |
| Limitations at that earlier milestone | Clock-derived development entropy and custom pair port (both since superseded); fixed denomination and finite tree capacity |

The report labels the lifecycle suite 7/7 but also lists deposit and A–E/duplicate-spend outcomes; preserve the concrete cases without inferring a different test count. The reported proving time is not a browser benchmark. The current lifecycle runner supersedes the original; the toy prover remains an offline historical fixture.

### Architecture decision — keep the pool as sender for this hackathon

Keep roots/nullifiers and funds in the shared pool, with the assembled validator reached by DELEGATECALL. The inspected client preserves the caller's storage/executing-address context and static flag across DELEGATECALL, which supports this split. Pin the validator implementation and verify deployed code; delegatecall success alone does not establish that APPROVE happened or that the expected scope was granted. The pool must fail closed on delegatecall/verifier failure. Source review of the user's pool and validator remains outstanding.

The one-pending-frame-transaction-per-sender rule is a **mempool admission policy**, not a consensus rule limiting a sender to one transaction in a block. With this node's normal submission path, treat the shared pool as serial: one outstanding transaction, then release the next after inclusion or definitive rejection. Same-nonce fee replacement is supported by the inspected policy, but changing fees changes the bound digest and requires a new proof/authorization. Extra sponsors do not remove the shared-sender bottleneck. [Pinned mempool implementation](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/crates/blockchain/mempool.rs)

For this demo, coordinate only within each browser: observe the shared sender, wait if visibly busy, build/prove, and submit directly. Cross-browser races are expected; refresh the nonce/quote/root as needed and reprove after contention. There are no server nonce reservations. Do not automatically fee-bump to replace another user’s transaction. Defer per-user senders: they change storage dependency and authorization assumptions. Two proof verifications are a cost of a proposed verify-twice design, not a protocol law.

**Authorization invariant — layout enforcement now reported implemented:** Full transaction binding prevents reuse of a proof on a changed transaction. It does not stop a valid note owner generating a fresh proof for a malicious transaction. The pool must reject a proved envelope that adds a direct ERC-20 transfer draining unrelated notes, a second withdrawal, arbitrary external calls, or module changes. Keep the planned product path of one SENDER frame targeting the pool's restricted withdrawal/swap dispatcher; perform transfers, AMM swap, and note settlement inside that reverting call. The multi-frame atomic-batch harness is useful protocol evidence. If retained in the product, enforce the exact permitted targets, selectors, amounts, recipients, atomic flags, and final note settlement before APPROVE.

Argumentless spend() remains the single source of truth for spend fields. The user reports `_findVerificationFrame()` now locates exactly one preceding pool VERIFY frame and works with a leading expiry frame. Preserve checks of mode, target, selector, position, and data length when adding the automatic paymaster frame. Keep nullifier checks in validation and immediately before execution effects.

### Indexer and persistence rule

Do not mark a note spent or an output created just because an individual frame reports success. The pinned client retains execution status for earlier frames in a rolled-back atomic batch while clearing their logs/state gas. Interpret the complete atomic group and canonical surviving logs, then reconcile nullifier/root state at the receipt block. Empty logs and zero state gas alone are not a unique rollback signal. Store block hashes for reorg recovery. Add the reported rolled-back-success-frame case to the indexer tests. [Pinned rollback implementation](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/crates/vm/levm/src/vm.rs)

### Private-swap accounting follow-up

The private-output round trip is now reported working. Preserve backing and later-spend checks when generalizing denominations: token/amount binding, conservation, and proof-bound output/change commitments; never mint notes against unrelated old balances. Improve the fixed output denomination so the displayed trade does not silently donate the unused quoted output to LPs, and replace unattributed `balance - accounted` credit with attributable settlement. These changes remain separate from free sponsorship.

### Successful native contract-account smoke run

The user reports the following results from `frame-demo.mjs` on a fresh local dev node:

| Check | Reported result |
| --- | --- |
| RPC | `http://localhost:8545` |
| Client | Ethrex v23.0.0, branch `frames-devnet-0`, abbreviated commit `d587cf9ff...`, Rust 1.93.0 |
| Identity | `eth_chainId = 0x9`; `net_version = 9` |
| Fork probe | EXPIRY_VERIFIER has 26 bytes of code; this does not by itself test expiry rejection |
| Block progression | 51 → 53 |
| Native transaction | Mined in block 56; reported success; gasUsed 22,093 |
| VERIFY frame | Success; execution gas 127; state gas 0; logs 0 |
| SENDER frame | Success; execution gas 3,000; state gas 0; logs 1 |
| Economic effect | Recipient +0.001 local test ETH; payer displayed as `0x4b8a3d61...` |
| Account and setup | A 14-byte deployed contract account; two signed setup transactions; native transaction has an empty signatures list |

These are the supplied run results, not an independently reproduced run here. The local VS Code link does not expose the script's contents in this workspace. Archive the full source, runtime bytecode, full sender/payer/recipient addresses, genesis hash, exact commit, transaction hash, and raw receipt with the project; abbreviated terminal output is not a complete deployment manifest. Keep the smoke script in the repository, for example `scripts/frame-demo.mjs`, instead of relying on its temporary session location.

**What the test proves:** The reported deployed account can grant execution and payment authority through APPROVE, and the node can include and execute the resulting native transaction. The described empty-calldata funding path avoids reaching APPROVE during an ordinary funding call.

**Historical limitation:** That first CALLDATASIZE guard was routing, not authentication: any caller could supply the dummy byte and request approval. The later spike below replaces unconditional approval with a pairing check, but its exposed setup still prevents a security claim. Our earlier EOA smoke script is a separate, signature-authorized route; neither earlier smoke test needs rerunning just to proceed.

### Historical Groth16 binding and sponsorship spike — superseded by lifecycle.mjs

| Scenario | Reported outcome | What it establishes |
| --- | --- | --- |
| A — valid proof, self-paid | Mined; both frames succeeded | Groth16 pairing check can gate native account execution and self-payment |
| B — one-bit proof corruption | Rejected at raw-transaction submission; canonical digest unchanged | Failure is isolated to the altered proof bytes |
| C — recipient changed after proving | Rejected; direct verifier true under original digest, false under mutated digest | The tested proof depends on the transaction-derived public input |
| D — valid proof, sponsored | Mined; payer is sponsor; sender balance reduced only by transfer amount | Execution approval and payment approval can be separated |
| E — reported snarkjs-style verifier | Rejected with `BannedOpcode(90)` | That compiled verifier's GAS/SUB sequence is incompatible with validation policy |

The reported account has 191 bytes of validation logic, reads the canonical digest through TXPARAM(0x08), obtains proof bytes through SIGDATACOPY, calls a deployed verifier, and approves on a true result. Its current-frame scope comes from FRAMEPARAM(0x06), allowing scope 3 for self-payment and scope 2 for sponsored execution.

Proof bytes are carried in an ARBITRARY signature entry with empty `msg`; only those raw bytes are elided from the digest. Frame data, signature metadata, nonce, chain ID, and fees remain committed. Preserve this mechanism. Require the expected slot, ARBITRARY scheme, empty `msg`, canonical proof/public-input encoding, and strict envelope shape in the final account.

**Measured gas, as reported:** VERIFY execution 199,523; complete transaction 225,685; the four-pair pairing call accounts for 181,000, about 90.7% of the VERIFY measurement. These are spike measurements, not a bound for the final circuit or complete sponsored prefix; the report does not give a separate full sponsored-prefix budget.

**Admission-policy correction:** The inspected client checks the sum of declared prefix execution limits plus signature-verification costs against MAX_VERIFY_GAS. A receipt's gas-used value alone cannot establish admission. The identical transaction's rejection at 100k proves that transaction does not fit that policy; it does not establish that exactly 1m is necessary or that every public operator uses 100k. The previously observed public Frames instructions advertised 500k. Test the final complete prefix at 500k locally, then verify actual public admission separately. [Pinned prefix-budget implementation](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/crates/common/types/transaction.rs)

**Verifier requirements discovered by the spike:**

- Keep the verifying key in runtime code/immutables, with no separate-verifier storage reads. Note roots and nullifiers remain in GhostAccount's sender storage.
- Preserve verification algebra while adapting the reported incompatible `staticcall(sub(gas(), 2000), ...)` pattern to validation-compatible gas forwarding. Test the exact generated bytecode; do not assume every generator/version has the same output.
- Literal call-gas budgets still need adequate EIP-150 forwarding headroom. They do not guarantee successful verification by themselves. Fail closed on call failure, unexpected return length, or any result other than canonical true.
- VERIFY is static: no LOG probes, state writes, or nullifier consumption. Emit diagnostics only in execution or through off-chain tracing.
- Keep the scope-adaptive account, but validate that the selected scope/frame layout is an allowed self-paid or sponsored shape. Reading a requested scope is not independently an authorization check.
- The pinned client permits one pending transaction per non-canonical paymaster. Handle busy admission in the browser with bounded retries and an explicit waiting state. Do not introduce a mandatory sponsor queue or application-side balance/nonce reservations; this remains a pending-capacity policy, not a permanent one-transaction limit.

**Historical follow-ups — latest reported implementation now addresses these:**

1. The real circuit replaced the toy prover. The latest setup report uses cryptographically random contribution entropy and verifies the zkey; retain artifact provenance and disclose the single-contributor development trust assumption. The older clock-seeded setup is superseded.
2. The latest circuit uses two range-constrained 128-bit digest limbs. Retain lossless encoding and mutation regressions. The older reduced single-field hash is superseded; it was an encoding concern, not a demonstrated practical collision attack.

The placeholder relation includes `txHash * txHash = txSq` to make the transaction-derived input participate in verification. The direct true/false verifier comparison supports that it works for the tested vectors. Retain differential tests when replacing the circuit; a declared public input or a cosmetic constraint alone is not a general proof of correct authorization. The final statement must prove note membership, ownership, unspent status checks, action binding, and value conservation.

**Preserve:** `groth16.mjs`, `keys.mjs`, `frametx.mjs`, `asm.mjs`, `accounts.mjs`, `bisect.mjs`, the verifier source/runtime hash, compiler 0.8.30 settings, proof/public-input vectors, raw transactions, receipts/rejections, exact node commit, and configured/declared gas budgets. Keep the reported init-code header regression test: every deployment must be followed by a byte-for-byte runtime-code check. These source files remain user-local and have not been inspected here.

**Latest reported functional milestone:** the private-output round trip and official Uniswap deployment now work. Automatic policy-based free sponsorship and browser-only submission remain to be integrated.

## Network findings that change the build

| Item | Verified observation or decision |
| --- | --- |
| Network | Ethrex **Frames testnet**, distinct from its Hegota/privacy testnet |
| RPC | `https://rpc1.frames.ethrex.xyz` |
| Chain ID | **81410**, returned by `eth_chainId` as `0x13e02`; the faucet page itself displayed “unknown” |
| Observed client | `ethrex/v23.0.0-HEAD-d587cf9ff0996315381c4b2784a4d7d499decc0f/x86_64-unknown-linux-gnu/rustc-v1.93.1` |
| Observed head | Block **162996** at the read-only check; this is a snapshot, not a freshness guarantee |
| Genesis hash | `0x4225d87803ea7b0da245a4390c18e8afe373cb0eb1482e218e1cdc200cfc27ab` |
| Faucet | `https://faucet.frames.ethrex.xyz/` |
| Advertised explorer | `https://dora.frames.ethrex.xyz`; build an application receipt view because frame-level explorer support is not established |
| Advertised EIP pin | Ethereum EIPs commit **`b75cbe6115`** |
| Client branch | Ethrex **`frames-devnet-0`**; resolve an exact compatible commit during setup |
| CLI | Rex **`frames-testnet`** branch; resolve and pin its commit too |
| Encoding | Type `0x06`; seven-field envelope; nested `fees`; two budgets per frame, `[execution, state]` |
| Validation budget | Faucet documents **500,000 execution gas** for the validation prefix; the pinned generic EIP text lists **100,000**. Verify actual acceptance on this deployment rather than assuming either value is universal. |
| Existing application contracts | No reusable AMM or privacy-pool deployment was verified. Plan to deploy our own. This is not a claim that no such contracts exist. |

Sources: [Frames faucet and network instructions](https://faucet.frames.ethrex.xyz/), [network-specific implementation notes](https://github.com/lambdaclass/ethrex/blob/frames-devnet-0/docs/eip-8141.md), [pinned EIP text](https://github.com/ethereum/EIPs/blob/b75cbe6115/EIPS/eip-8141.md), and read-only JSON-RPC responses from the endpoint above.

**Keep the networks distinct.** The inspected `@jaw.id/frametx-kit` README targets the public Hegota chain 8141. Treat it as a reference until byte-for-byte compatibility with Frames 81410 is established. The local `l1-hegota.json` genesis on the Frames branch is a valid, separate development route; its filename does not mean we should copy public Hegota settings. Some Ethrex documentation retains older scalar-gas and privacy-network examples. The current faucet, pinned source, reference transaction bytes, and live acceptance tests take priority over stale examples. [Frame kit reference](https://github.com/JustaLab-co/frametx-kit)

Ethrex's ZK execution work does not supply an application privacy pool. The user has now built local commitment, verifier, and nullifier components; browser note storage/recovery and robust public Merkle-path indexing still need completing.

## Local development setup supplied by the user

Use local Ethrex as the default environment for Phases 0–6. Public Frames acceptance is a separate deployment milestone, rather than a prerequisite for every development iteration.

The previously inspected `frames-devnet-0` checkout is commit `d587cf9ff0996315381c4b2784a4d7d499decc0f`; the user's exact local commit still needs recording. That reference checkout pins Rust **1.93.0**. Its CLI implements `--mempool.max-verify-gas` and explicitly describes it as **mempool policy, not consensus**. The supplied genesis sets chain ID **9**, with Amsterdam/Hegota activation at genesis. The latest supplied run reports chain ID 9; retain the RPC checks below for restarts and evidence capture. [CLI source](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/cmd/ethrex/cli.rs), [local dev-mode guide](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/docs/developers/l1/dev-mode.md), [genesis](https://github.com/lambdaclass/ethrex/blob/d587cf9ff0996315381c4b2784a4d7d499decc0f/fixtures/genesis/l1-hegota.json)

**Current execution evidence:** The user reports lifecycle, malicious-layout, roundtrip, and official-pair swap tests passing. Preserve those results; the new signature-free paymaster policy still requires its own compatibility test. Public acceptance remains separate.

For reproducing the environment later, use a separate fresh checkout. The existing running checkout does not need this step:

```bash
git clone --branch frames-devnet-0 --single-branch https://github.com/lambdaclass/ethrex.git ethrex
cd ethrex
```

Pin that reproduction checkout to the exact working commit recorded in the manifest. Build first:

```bash
cargo build --release --features dev --bin ethrex
```

After the build succeeds, run the binary as a **separate command**:

```bash
./target/release/ethrex \
  --dev \
  --network fixtures/genesis/l1-hegota.json \
  --mempool.max-verify-gas 1000000
```

Keep the running node's existing data directory. The user's command does not specify `--datadir`; record the actual directory before any later restart. An optional isolated `--datadir` pointing to a new directory starts fresh chain state and requires fresh deployments. `--dev` supplies local block production; it does not connect this genesis to the public Frames chain. The documented local test accounts are under `fixtures/keys/private_keys_l1.txt`; they are public development fixtures, not credentials for real funds.

| Environment/profile | Endpoint and identity | Verify-gas policy | Purpose |
| --- | --- | --- | --- |
| Current local development | `http://localhost:8545`; chain 9 confirmed in the user-reported run | `1000000`, user-supplied startup configuration | Real-circuit lifecycle, official-pair swaps, and private-output round trip reported passing; integrate automatic free sponsorship |
| Local public-budget compatibility test | Same local genesis, separately recorded run configuration | `500000` | Test against the public faucet's advertised budget after local functionality works; other compatibility checks remain necessary |
| Local diagnostic | Same local genesis, clearly recorded run configuration | For example `2000000` | Diagnose a verifier that exceeds the current budget; passing here is not public acceptance |
| Local strict test | Same local genesis | `100000` | Optional comparison with the pinned EIP's default policy, not the weekend's required target |
| Public Frames | `https://rpc1.frames.ethrex.xyz`, chain 81410 | Operator-controlled; advertised as 500k | Demonstrate acceptance and execution on the shared network |

Changing this CLI budget does not relax proof correctness, transaction authorization, forbidden validation-state dependencies, per-frame budgets, or consensus gas constraints. The current local target is **1,000,000**; **500,000** is a later public-budget compatibility target. Neither changes the public operator's configuration. Record the minimum budget that actually admits the complete proof-and-sponsor prefix, including all declared prefix execution limits and signature costs.

### Identity capture and restart checks

The initial identity check has passed in the reported run. Use these commands to capture the missing full identifiers or to verify a later restart. In a second terminal, from the running node's Ethrex checkout, record the source commit:

```bash
git rev-parse HEAD
```

Query the expected local endpoint; use the node's actual HTTP address and port if different:

```bash
curl -sS http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  --data '[{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},{"jsonrpc":"2.0","id":2,"method":"web3_clientVersion","params":[]},{"jsonrpc":"2.0","id":3,"method":"eth_blockNumber","params":[]},{"jsonrpc":"2.0","id":4,"method":"eth_getBlockByNumber","params":["0x0",false]}]'
```

Match responses by `id`: expect chain ID `0x9` from the supplied genesis, record the client version and block-zero `hash`, and repeat the block-number check to confirm RPC-visible progression. If the chain ID differs, resolve the configuration mismatch before deploying.

Create the local deployment manifest with RPC URL, returned chain ID, genesis hash, source commit, client version, data directory, startup command, and the **1,000,000** verify-gas setting. Add Rex/compiler/circuit pins and contract addresses as each is established; do not fill unknown fields with public-network values. Archive the already successful signed setup transactions and **native frame transaction**, saving their hashes and receipts separately. Repeat the smoke run only if those artifacts were lost or the environment changes. An ordinary transfer does not establish frame support.

Deploy separate local contracts. Never reuse public addresses, roots, notes, or transaction signatures on the local chain. A genesis reset also requires fresh contract deployment and indexer/note-state reconciliation.

## Architecture and scope

There are **two different pools**: the Uniswap pool holds market liquidity; GhostAccount holds assets backing private notes. They are separate contracts with different jobs.

| Component | Responsibility | Build or reuse |
| --- | --- | --- |
| Frames network | Execute native frame transactions | Use pinned local Ethrex for development; verify a separate public deployment |
| WETH + DemoUSDC | Test trading assets | Deploy known WETH implementation and clearly labeled mintable test stablecoin |
| Uniswap v2 factory/pair | Price and settle WETH/DemoUSDC trades | Deploy pinned official v2 core contracts and seed liquidity |
| `GhostAccount` | Shared transaction sender, token custody, commitment tree, roots, nullifiers, restricted execution | Build |
| `GhostFrameValidator` | Validate proof and complete frame envelope; return the execution approval scope | Build to ERC-8286's type-11 interface, with the required ERC-7579 module lifecycle surface |
| Generated verifier contracts | Verify real swap/withdrawal proofs | Generate from pinned circuits/toolchain |
| `GasSponsor` | Prefunded ETH subsidy; automatically approve payment for supported proof-authorized pool actions | Build a bounded policy contract with no per-transaction sponsor signature |
| Browser note wallet | Keep secrets, construct witnesses, prove, recover local state | Build around existing cryptographic libraries |
| Indexer | Publish public commitment/nullifier data and track canonical chain state | Build a small service; never custody note secrets |
| Browser transaction controller | Observe nonce/pending state, build/prove, submit, reconcile, retry contention | Build client-side; no authoritative reservation service |
| Optional relay | Forward completed raw bytes only | Optional transport; direct RPC path remains available |
| Frontend | Deposit, private balance, quote, swap, withdraw, transaction evidence | Build |

Use **one SENDER frame targeting GhostAccount**, which dispatches a restricted swap internally. In that one call, consume the note, push tokens to the pair, execute the swap, check balance changes, and insert replacement notes. If any step fails, EVM rollback restores all trade state.

This deliberately refines the earlier multi-SENDER-frame sketch. It avoids leaving a transfer in one frame and note settlement in another. Native EIP-8141 still supplies contract-originated transactions, proof-based authorization, and separated gas payment. ERC-8286 supplies the modular validation interface. Ordinary contract-call atomicity handles this MVP's internal swap; we should not claim its atomicity requires a new protocol primitive.

ERC-8286's contract-dispatched route is the relevant model: every SENDER frame must target the account. The account applies APPROVE after its validator returns the permitted scope. Merely implementing a function with the right name is not proof of full ERC-7579/8286 conformance; document the implemented lifecycle, execution modes, and limitations. Freeze the validator configuration after initialization for this shared-pool prototype. A note holder must never gain authority to install a new validator or arbitrary execution module. [ERC-8286](https://eips.ethereum.org/EIPS/eip-8286)

**MVP boundaries:** one chain, one pair, standard non-rebasing/non-fee-on-transfer tokens, one input note per action, a spendable private output note (change notes when variable amounts are implemented), browser proofs, free testnet gas from a separate prefunded policy paymaster, no sponsor signing service or mandatory nonce coordinator, no arbitrary routing, and no private-fee reimbursement protocol. Avoid giving users a generic arbitrary-call executor.

## Phase 0 — prove network and cryptographic compatibility

**Goal:** Resolve the failure points that could invalidate the whole architecture before building the interface.

1. **Startup, RPC identity, and simple native execution passed in the user-reported run; finish evidence capture.** Keep the running node and use the identity capture checks above. Record RPC, chain ID, genesis hash, client version, EIP pin, client/CLI commits, compiler versions, circuit-toolchain versions, and configured verify-gas budget in a deployment manifest. Check the genesis hash at each application startup so a reset cannot silently reuse stale addresses or notes.
2. Configure an isolated local test deployer from the documented prefunded fixtures. For the later public deployment, use a separate deployer and obtain faucet ETH. Use ordinary transactions for contract deployments and liquidity setup.
3. **Simple native transaction passed.** Preserve `frame-demo.mjs` and its receipt. The working hand-encoded script is sufficient for this gate; Rex is optional as an independent codec reference, not a prerequisite. The supplied output reports successful VERIFY and SENDER frames.
4. **Frame encoding and canonical digest binding exercised in the reported spike.** Preserve frametx.mjs, the proof-corruption digest-invariance check, and the direct original/mutated-digest verifier comparison. Compare against independent pinned Ethrex/spec vectors or compatible Rex output. Extend coverage to all final envelope fields and the lossless digest encoding.
5. **TXPARAM, FRAMEPARAM, SIGDATACOPY, and proof-gated APPROVE exercised in the reported spike.** Preserve and pin the assembler/opcode-wrapper pipeline, including scope selection and funding behavior. Check deployed runtime bytes against the expected account code to prevent recurrence of the reported init-code header offset bug. Released Solidity tooling must not be assumed to understand these draft opcodes.
6. **Groth16 and A–E reported passing on the real spend circuit.** Preserve lifecycle.mjs, attack.mjs, roundtrip.mjs, and swap.mjs regressions. Random setup entropy and full digest limbs are reported implemented; retain resulting verifier/proving-key hashes and setup provenance.
7. **Sponsored compatibility passed; final prefix policy tests remain.** Measure both declared prefix execution limits plus signature costs and actual gas used for the full spend circuit, expiry, and sponsor authorization. The spike ran at **1,000,000** and failed at the default 100k. Test **500,000** separately after choosing realistic frame limits; archive the exact declared limits. Check expiry, fee/budget caps, failed-execution charges, and browser handling of sender/paymaster contention. Local acceptance does not establish public-network acceptance.
8. Test mempool restrictions: roots/nullifiers reside in **sender storage**; verifier constants are in code; validation must not read pair reserves, ERC-20 balances, or another pool's mutable storage. Use the canonical leading expiry frame instead of reading TIMESTAMP in arbitrary validation code.
9. Save the local startup/deployment procedure for repeatable failure tests. Attempt the public-network smoke test once the local native proof succeeds, and track its result separately. A stock Anvil chain or ordinary mainnet fork does not acquire draft opcodes just because custom transactions are sent to it.

**Deliverables:** local network manifest, exact toolchain pins, frame test vectors, native-account probe, real-verifier gas measurement, successful local native frame receipt, reproducible startup procedure, and an explicit public-compatibility result or open issue.

**Local compatibility gate:** Real-circuit lifecycle, restricted layout, official-pair swap and private-output round trip are reported passing. **New sponsorship gate:** prove the automatic policy paymaster works without a service signature and within validation restrictions. **Public gate:** separately demonstrate the complete transaction fits the public operator’s policy and mines on chain 81410. A local-only demo must disclose its configuration.

The pinned EIP's policy permits sender-storage dependencies and restricted code calls, but rejects arbitrary third-party mutable-state dependencies during validation. Keep note state inside the native sender account for that reason. [Pinned EIP mempool rules](https://github.com/ethereum/EIPs/blob/b75cbe6115/EIPS/eip-8141.md#mempool)

## Phase 1 — deploy and prove approval-free exchange infrastructure

**Goal:** Preserve the reported deployed official Uniswap v2 integration and swap/rollback tests. The earlier port is historical; retain official source pins, factory-created pair provenance, and deployment-bytecode comparisons.

Deploy WETH, DemoUSDC, the official Uniswap v2 factory, and one WETH/DemoUSDC pair. Seed test liquidity by pushing both assets to the pair and minting LP tokens. Record addresses, source commits, bytecode hashes, deployment transactions, token ordering, decimals, and starting reserves. Do not assume familiar mainnet addresses exist here.

Retain the tested swap harness and run it against the official deployment. It must:

- transfers the exact input amount directly to the pair;
- calls `pair.swap(...)` with the correct token ordering, fixed recipient, and empty callback data;
- checks the input/output balance changes;
- reverts the entire call if the quote cannot settle.

No Router, Permit2, or exchange allowance is necessary. Uniswap v2 determines input from transferred token balances; transfer and swap must be atomic. [Uniswap v2 swap mechanics](https://developers.uniswap.org/docs/protocols/v2/concepts/swapping), [official v2 core](https://github.com/Uniswap/v2-core)

Use a **quote-locked trade** for the first privacy circuit: spend exactly X and receive exactly Y before a deadline, or revert. Y is known before proving and can be committed inside the output note. Show the exact quote to the user. This does not dynamically capture a better price after proof creation, and adverse reserve changes may require a fresh quote and proof. Avoid pretending it has a general router's flexible exact-input settlement.

**Gate:** Swaps work in both directions; an intentionally impossible quote rolls back the input transfer; all configured exchange allowances from the harness are zero. The later GhostAccount path must repeat these checks independently.

### Official Uniswap compiler workaround — verified locally

The native compiler download host is not required. On September 22, the assistant installed the npm compiler and compiled the official v2-core 1.0.1 package sources successfully with Solidity 0.5.16+commit.9c3226ce, optimizer enabled (999999 runs), EVM target Istanbul. Pair creation/runtime were 11,636/11,293 bytes; Factory creation/runtime were 13,958/13,859 bytes. This was a compiler check, not deployment or a claim of byte-for-byte identity with an existing mainnet deployment. Sources, paths, metadata, and compiler settings all matter for reproducing deployed bytecode.

Install alongside the current tooling; the alias preserves the existing newer compiler dependency:

```bash
npm install --save-dev --save-exact solc-v2@npm:solc@0.5.16 @uniswap/v2-core@1.0.1
```

Compile via solc-js standard JSON and use the resulting ABI/creation bytecode in the existing deployer. Do not point Forge at solc-js as though it were a drop-in native compiler. This recipe collects the official package sources and writes separate Pair/Factory artifacts:

```bash
node <<'JS'
const fs = require('fs');
const path = require('path');
const solc = require('solc-v2');
const root = path.dirname(require.resolve('@uniswap/v2-core/package.json'));
const sources = {};
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.name.endsWith('.sol')) {
      sources[path.relative(root, file).split(path.sep).join('/')] = {
        content: fs.readFileSync(file, 'utf8')
      };
    }
  }
}
collect(path.join(root, 'contracts'));
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 999999 }, evmVersion: 'istanbul',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(e => e.severity === 'error');
if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
fs.mkdirSync('artifacts/uniswap-v2', { recursive: true });
for (const name of ['UniswapV2Pair', 'UniswapV2Factory']) {
  const contract = output.contracts['contracts/' + name + '.sol'][name];
  fs.writeFileSync('artifacts/uniswap-v2/' + name + '.json', JSON.stringify({
    compiler: solc.version(), abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object
  }, null, 2));
}
console.log('Compiled official v2 sources with', solc.version());
JS
```

Deploy Factory with the intended feeToSetter constructor argument, create the pair through Factory, seed liquidity, record new addresses, and rerun all three swap tests. Ensure the harness respects the official pair's full ABI and token order. [solc-js standard JSON interface](https://github.com/argotorg/solc-js), [official Uniswap v2 core](https://github.com/Uniswap/v2-core)

## Phase 2 — build the real private-note lifecycle

**Goal:** Deposit creates a spendable secret note; a real proof can withdraw it once.

Suggested starting stack: Circom 2 + circomlib/Poseidon + snarkjs Groth16 over BN254. Reuse libraries and established commitment/nullifier patterns rather than inventing cryptography. Pin all versions, compile actual constraints, and generate the matching Solidity verifier. Adapt its precompile call-gas code to the tested validation policy without changing the verification algebra; check the compiled bytecode and fail-closed return handling. Groth16 setup is circuit-specific; record the ceremony/setup provenance and artifact hashes. A local development setup must disclose its trust assumptions. Do not reuse the spike's published deterministic trapdoor: anyone can forge proofs under it, so it cannot substantiate a secure-spend demo even with test funds. Record setup contributions and artifact provenance for the actual spend circuit; a production claim requires a separately justified trust model. [snarkjs](https://github.com/iden3/snarkjs)

Proposed variable-amount note structure (future/generalized design; the reported current lifecycle uses fixed denominations):

- private note data: token, integer amount, random spend secret, random blinding value;
- domain: version, chain ID, account address, and distinct hash-domain tags;
- owner commitment derived from secret and blinding value;
- leaf commitment derived from domain, token, amount, and owner commitment;
- nullifier derived from secret/blinding using a separate hash domain.

Fix the precise Poseidon arities and encoding in a shared specification; use identical vectors in circuits, Solidity, and TypeScript. The latest circuit uses two range-constrained 128-bit digest limbs and 6,391 constraints. Preserve their participation in action authorization and match the verifier input encoding exactly.

The current implementation has a depth-10 append-only Merkle tree (1,024 leaves) in GhostAccount. Keep depth 10 for the hackathon; increasing depth changes circuit constraints, proving artifacts, and deposit gas, so it is not a configuration-only change. Maintain a bounded history of accepted roots and spent nullifiers. Keep the tree/root/nullifier storage in this account, not an external mutable pool contract that validation would have to read.

**Approval-free initial deposit:** `depositNative(ownerCommitment)` receives ETH, wraps exactly `msg.value` into WETH, constructs the leaf using the actual credited amount, and appends it atomically. A user-supplied opaque leaf must not be accepted without binding it to the deposited value. Publishing the owner commitment must not reveal the spend secret or allow computation of its nullifier.

This first deposit path requires no token approval. Arbitrary ERC-20 deposits are a later feature; an exact allowance to the privacy vault would be a separate permission from an exchange allowance and must be shown honestly if added.

Build shared circuit gadgets for membership, note ownership, nullifier derivation, bounded amounts, and action authorization. Use separate small swap and withdrawal circuits if that keeps constraints easier to inspect:

- **Withdrawal:** prove ownership of an unspent note, bind public recipient/asset/amount, and conserve any private change.
- **Swap:** prove ownership; enforce `inputNote.value = amountIn + changeNote.value`; bind the swap output note to `assetOut` and the exact `amountOut`; bind both new commitments and the action authorization.

Support one input note initially. The interface must show spendable capacity under that limitation; a sum of several small notes is not automatically spendable as one note. Define a fixed convention for zero change, such as a zero-value change note that the wallet ignores, and enforce the same convention everywhere.

**Gate:** Valid withdrawal proof succeeds; invalid membership, altered public inputs, wrong recipient, double spend, amount overflow, and incorrect conservation fail. Reloading the wallet and restoring its encrypted note backup recovers the ability to spend.

## Phase 3 — authorize native transactions and provide free automatic sponsorship

**Goal:** A ZK proof authorizes exactly one allowed action from GhostAccount, with no outer personal-wallet transaction.

Target product transaction shape (use the reported verification-frame discovery; do not hardcode frame 0):

| Order | Frame | Purpose |
| --- | --- | --- |
| 0 | VERIFY, canonical expiry target | Enforce the quote/authorization deadline using the network's approved expiry mechanism |
| 1 | VERIFY, GhostAccount, execution scope | Invoke GhostFrameValidator; verify proof, note state, complete envelope, and allowed operation; account applies execution APPROVE |
| 2 | VERIFY, GasSponsor, payment scope | Check the supported pool/envelope and gas/fee caps; apply payment APPROVE automatically, without a sponsor signature |
| 3 | SENDER, GhostAccount | Execute the restricted swap or withdrawal atomically |

Pin the exact flags, calldata, expiry target/runtime, and opcode wrappers to the tested client. Reject extra frames, alternate targets, arbitrary external calls, extra signature slots, nonzero unexpected values, blob fields, and unsupported execution modes.

**Avoid the proof/hash circularity.** Put proof bytes and proof-only data in the predefined ARBITRARY signature entry with empty `msg`. There is no sponsor-signature slot in the new MVP envelope. Build every frame, including the paymaster frame, first; calculate the canonical digest; generate the proof locally; insert it without changing that digest. Bind the full frame list, chain ID, sender nonce, fee limits, and expiry. Reject unused or unexpected signature entries.

The circuit must actually constrain transaction authorization, not merely expose an unused `txHash` public input. One design to evaluate is a domain-separated authorization tag derived in-circuit from the note secret and the digest limbs; the tag travels with the proof, outside the hashed frame payload. Match every other public signal to the exact execution parameters. Include negative tests proving a proof cannot be transplanted to a different nonce, fee envelope, frame list, recipient, output commitment, or chain.

Validation is read-only. Check whether a nullifier is unused there, but consume it only during execution. Recheck it at execution entry. Never try to write nullifiers or spending counters inside `validateFrame`.

For the contract-dispatched route, require SENDER mode, the expected frame position, native sender equal to GhostAccount, target equal to GhostAccount, and authenticated self-execution. `msg.sender == ENTRY_POINT` alone is not authorization. Restrict the account's dispatch to known swap/withdraw operations and reject module installation or arbitrary execute payloads from note holders.

**Gas MVP — accepted decision:** Deploy `GasSponsor` as a separate contract and prefund it with a deliberately limited amount of faucet ETH. It pays gas for permitted swaps and withdrawals; it never deducts gas from users' notes. The pool remains the sender and token custodian. The paymaster funding wallet only funds the contract; it does not sign individual Himitsu transactions.

**Automatic sponsorship policy to implement:**

1. Pin the supported input-pool sender addresses and their trusted validation implementations at deployment. Each supported pool (including the output pool used for later withdrawals) must be explicitly covered. Do not authorize arbitrary contracts merely because they imitate a validation selector.
2. Require the exact prefix and execution layout above: canonical expiry, one trusted pool execution approval, this paymaster payment approval, and one sanctioned pool SENDER call. Use transaction/frame introspection and immutable code constants; do not add another pairing check solely for sponsorship. The trusted pool is responsible for proof verification and action restrictions, and payment approval must occur after execution approval. Confirm this ordering on the pinned node.
3. Bound maximum transaction cost, fee caps, and declared execution/state limits, with realistic lower budgets for required work. Reject value transfers, blobs, unsupported actions and extra frames. Use the network expiry verifier rather than prohibited timestamp reads in custom validation.
4. Keep policy constants in code/immutables for this deployment. Because the paymaster is not `tx.sender`, its own mutable storage is not an allowed validation dependency under the pinned generic rules. Do not implement per-user counters, mutable allowlists, or a balance `SLOAD`/`BALANCE` check there. Leave upfront ETH solvency and pending-cost accounting to the node/protocol. Record policy changes through an explicit redeployment/manifest update.
5. Call `APPROVE` with payment scope only after those checks. The contract must reject unsupported use; a fallback must not grant unconditional payment approval. Keep a plain funding path that accepts ETH without running native approval outside its valid context.

**Funding and admission:** Native ETH must be available before admission; future swap proceeds cannot finance the upfront requirement. The UI may display the paymaster balance using ordinary RPC reads and report insufficient sponsorship funds. The protocol/node performs the authoritative affordability check. Keep note backing untouched. The current noncanonical paymaster has a one-pending-transaction restriction; browsers handle busy responses just as they handle shared-sender contention. No app server issues gas tickets or reserves sponsorship balances.

**Explicit subsidy limit:** Failed execution restores trade state but the paymaster still pays gas and the sender nonce is consumed on an included, payment-approved transaction. A note owner can repeatedly cause a permitted swap to fail; per-transaction caps do not stop repeated subsidy spending. Limit the funded demo balance, avoid automatic unlimited top-ups, and accept this MVP limitation. Reimbursement, fee notes, private fee accounting and an economic anti-abuse mechanism are deferred. The reserve is not claimed to be sustainable or abuse-proof.

**Gate:** A real proof-authorized transaction mines with the paymaster as payer and no sponsor signature or backend authorization request. Pool ETH/note backing are unaffected by gas charges. Unsupported senders/layouts and excessive budgets are rejected; failed swaps restore notes while charging paymaster gas; an empty paymaster produces a clear recoverable error. Measure the complete new prefix and both gas dimensions on the pinned node. Earlier sponsored A/D results do not substitute for this policy test.

## Phase 4 — connect private accounting to the real AMM

**Goal:** One transaction converts an existing private note into genuinely backed output/change notes.

Inside the one authorized execution call:

1. Recheck action kind, allowed pair, token identities, note nullifier, and parameter bounds.
2. Snapshot GhostAccount's input/output token balances.
3. Mark the input nullifier spent within this reverting execution scope.
4. Transfer exactly `amountIn` to the allowlisted v2 pair.
5. Call the pair with the quoted output amounts, GhostAccount as recipient, and empty callback data.
6. Check actual balance deltas: input decreased by exactly the authorized input and output increased by exactly the amount backing the new output note.
7. Append the proof-bound output and change commitments; emit public commitment/nullifier events.

Do not credit output merely because the pool already holds enough of that token. The new note must be backed by the current operation's received output. Reject rebasing, fee-on-transfer, unexpected callbacks, and substituted tokens in this MVP. Add a reentrancy guard; all external calls must either succeed with expected behavior or revert the entire action.

Neither the input owner's wallet nor an output EOA appears as the DEX recipient: the account receives the swap output. The token transfer, pair call, and commitment insertion either all settle or all roll back.

**Gate:** Deposit → real proof → native sponsored swap → spend/withdraw the resulting note succeeds. Also pass adverse-price rollback, appended-call rejection, substituted-recipient rejection, double-spend rejection, and reserve/accounting checks. Verify zero configured exchange allowances and absence of `approve`, `permit`, or Permit2 authorization in the swap path.

## Phase 5 — run privacy infrastructure and build the consumer flow

**Goal:** A fresh user completes the whole journey through the app without CLI steps.

| Service | Required behavior |
| --- | --- |
| Static web app | Network status, deposit, private balances, quote-locked swaps, withdrawals, encrypted backup/restore, readable errors |
| Prover web worker | Generate proofs locally; expose progress and cancellation; never send witness/secret material to the server |
| Indexer | Read canonical surviving logs; interpret complete atomic batches; reconcile roots/nullifiers at receipt blocks; persist block hashes and roll back on reorgs |
| Public state API | Serve complete small-tree snapshots or bulk event ranges, so requesting one specific private leaf/path does not identify the user's note |
| Quote logic | Read the actual pair reserves and compute the quote locally or through a public-data API |
| Browser transaction controller | Read nonce/pending state, prove, submit directly, reconcile receipts and retry contention; no service reservations |
| Optional relay | Forward raw bytes only; no signing, sponsorship approval, or exclusive nonce allocation |
| Receipt adapter | Decode full frame groups, payer, gas, and logs; represent an executed-but-rolled-back frame separately from a persisted action; never infer persistence from success alone |

The browser verifies the reconstructed tree against an accepted onchain root. An indexer's response must not become trusted accounting state. Store note secrets encrypted locally, with a backup format that contains the information required for recovery. Save pending output-note secrets **before broadcasting** so a browser crash after inclusion does not strand the output. Reconcile pending transactions against canonical receipts after reload. A recovery phrase alone is insufficient unless note derivation and discovery were designed to support it.

Use one in-flight operation per browser and observe the shared sender before proving. Read its confirmed nonce and compare pending state when the RPC exposes it. If busy, show “Another swap is processing.” If apparently available, freeze the complete envelope, save pending note secrets, prove, and submit directly. These reads are advisory, not an atomic reservation: two browsers can race.

On sender/paymaster-busy rejection or a stale nonce, wait for a new block or relevant receipt with randomized bounded backoff, refresh the nonce, accepted root, quote and expiry, and reprove if any bound field changes. Stop and request user review if a refreshed quote exceeds the user's accepted price bounds. Do not automatically fee-bump to replace another user's transaction or broadcast an unbounded retry loop. A transport timeout has unknown submission status: reconcile the transaction hash and chain state before constructing a different transaction. Preserve pending-note recovery across reloads. No mandatory coordinator or cross-browser reservation service exists; this is not a throughput or fairness fix and does not introduce keyed nonces.

Connect the ordinary wallet for the initial deposit only. Private actions use local note secrets and native transaction bytes; they do not require another personal-wallet signature. Do not attach wallet addresses, account sessions, or analytics identifiers to quote/proof/broadcast requests. RPC and server metadata can still link activity; ordinary browser transport does not solve network-layer privacy.

Run the frontend, indexer/API, and browser transaction controller against local Ethrex, then switch the deployment manifest for a separately verified public deployment. The paymaster is an onchain contract, not a signing service. Keep funding/deployer keys out of the frontend; no runtime sponsor key is required. A relay may help transport but must be optional. Host proving artifacts with hashes and correct caching/CORS, and retain reproducible local deployments.

**Gate:** Two clean browser profiles independently deposit and trade without a sponsor-signing or nonce-coordinator backend. Submit concurrently to exercise contention: both eventually complete under the tested benign contention case without fee-replacing one another. This is a functional demo, not a fairness guarantee. Verify backup recovery, indexer restart, stale-quote handling, nonce refresh/reproving and empty-paymaster errors. The funded paymaster and RPC/network remain availability dependencies; backend independence is not indefinite gas availability or network-layer anonymity.

## Phase 6 — harden the money flow and make the demo convincing

**Goal:** Show the consumer outcome and make every important claim inspectable.

Required checks, on both the reusable local setup and the public deployment where applicable:

| Test | Expected result |
| --- | --- |
| Corrupt witness/proof or invalid Merkle membership | Validation fails; no note or token movement |
| Change any authorized recipient, amount, commitment, deadline, frame, fee cap, nonce, or domain | Old proof/authorization is unusable |
| Append a SENDER transfer or substitute an executor | Rejected before execution |
| Execute a previously consumed note | Rejected |
| Move pair price beyond the quoted output | Execution reverts; principal note remains spendable; sponsor pays gas |
| Swap completes | New commitments correspond to actual token deltas; old note is spent |
| Attempt arbitrary module changes or calls, even with a freshly generated valid note proof | Rejected before unrelated pool assets can move |
| Successful early frame followed by failure in its atomic batch | UI/indexer report rollback; no spent-note or output-note updates from discarded effects |
| Inspect allowances | Zero for the configured exchange spenders throughout; call traces confirm no temporary allowance |
| Empty paymaster / expired transaction | Clear recoverable failure; no misleading success state |
| Sponsor/coordinator backend stopped | Direct browser proof/submission succeeds; no sponsor signature requested |
| Two browsers race for the shared sender | Contention is detected; losing operation waits, refreshes and reproves without automatic replacement |
| Unsupported pool or over-budget sponsorship | Policy rejects payment approval before unsupported execution |
| Insufficient state-gas budget | Inspect declared budgets and reproduce with sufficient state gas; receipt execution consumption alone must not be treated as proof of execution OOG |
| Crash after broadcast | Persisted pending notes recover after receipt reconciliation |
| Reorg or network reset | Canonical state rebuilt or deployment rejected; no silently stale private balance |

For accounting tests, use a test harness that tracks the plaintext value of its generated notes and compare per-token liabilities with assets across deposit/swap/withdraw sequences. Test conservation and rollback as properties, not just one scripted success. Production security review remains separate from a hackathon test suite.

Use several separately controlled demo depositors and similar deposit denominations before the stage trade. Label them as demo participants; do not equate their count with a quantified real-world anonymity guarantee. Freshly depositing a unique amount and immediately trading it remains easy to correlate even when the cryptography is correct.

Suggested 90-second presentation:

1. “I want to trade without publishing my personal wallet's next move or leaving spending permission behind.”
2. Open an existing private balance; choose a quote and click Swap.
3. Show the actual native receipt: sender is GhostAccount, gas payer is separate, exchange allowances remain zero, and the private output balance updates.
4. Show a pre-prepared transaction with an added transfer or altered recipient being rejected.
5. Trigger a bad quote on the reproducible demo setup; show the original note remains spendable and explain that gas was still paid.
6. Withdraw from the successful output note, proving it represents usable assets rather than a UI counter.

Show both a clean consumer view and an expandable technical receipt. The public panel must display the pair and amounts that really are public. Do not replace them with fake “hidden” fields.

## Phase 7 — submission, reproducibility, and scope freeze

**Primary bounty: Uniswap's Best Uniswap Stack Contribution, new-build track ($6,000 pool).** The published rules explicitly include v2 integrations. Himitsu's use of the pair is central to its approval-free settlement. Include a public repository, README pointers to the relevant integration code, `FEEDBACK.md`, and the required Developer Feedback Form. Label the reported deployed contracts as our testnet deployment of official Uniswap sources, with compiler settings and bytecode evidence; do not imply an official Uniswap-operated deployment. Prize eligibility and selection remain the organizers' decision. [Tokyo 2026 prize rules](https://ethglobal.com/events/tokyo2026/prizes)

Do not add World, ENS, or another chain purely to fill the three-prize allowance. No second sponsor is necessary for this architecture.

Deliver:

- deployment manifest with network identity, contract addresses, code/artifact hashes, pins, and transaction hashes;
- circuit sources, verifier generation/setup instructions, and documented provenance of reused code;
- one reproducible deployment/liquidity/seed procedure and one end-to-end demo command;
- frontend URL, video, working receipt view, and documented local fallback;
- threat/visibility description covering public amounts, metadata, tiny demo anonymity set, paymaster funding dependence, browser nonce contention, and test-only setup;
- integration feedback and honest commit history within the applicable event track's rules.

Private swaps already exist, including RAILGUN integrations. The proposal's distinguishing implementation is **a proof-authorized native shared account that trades through a real AMM without exchange allowances or an outer personal EOA transaction**. Do not pitch it as the first private DEX or claim that allowance-free contract swaps were impossible before EIP-8141. [RAILGUN private swap flow](https://docs.railgun.org/wiki/learn/integrating-railgun/example-dex-swaps)

## Suggested repository layout

| Location | Contents |
| --- | --- |
| `apps/web/` | Deposit/private wallet/swap/withdraw UI; local proof worker |
| `services/indexer/` | Public event index, root checks, canonical checkpoints |
| `apps/web/` transaction controller | Nonce/pending observation, local proving, direct RPC submission, bounded retry and recovery |
| `services/relay/` (optional) | Stateless forwarding only; no sponsor keys or authoritative nonce reservations |
| `packages/contracts/` | GhostAccount, validator, automatic policy paymaster, verifier artifacts, deployment/funding scripts |
| `packages/circuits/` | Shared note gadgets, swap and withdrawal circuits, setup manifests |
| `packages/frame-codec/` | Network-pinned encoding, hashing, signature format, receipt decoding |
| `packages/note-wallet/` | Note format, witnesses, encryption, backup, pending-operation recovery |
| `packages/shared/` | Contract ABIs, deployment identity, parameter schemas, hash/test vectors |
| `deployments/` | Public and local network manifests, addresses, evidence |
| `tests/e2e/` | Native success/failure flows and accounting invariants |

## Execution order and weekend allocation

Phases 0, 2, and 3 contain the largest uncertainty. A polished UI cannot compensate for an unworkable verification prefix or unbacked output notes.

Local startup, native proof execution, the restricted asset lifecycle, official Uniswap and a spendable private-output round trip have passed according to the latest user report. Prioritize automatic sponsorship and browser integration rather than repeating completed milestones. For a team of three, use this time-boxed target as guidance, not a promise:

| Elapsed hackathon time | Target |
| --- | --- |
| Hours 0–4 | Implement immutable automatic paymaster policy; prefund test ETH; prove signature-free sponsorship on the pinned node |
| Hours 4–14 | Integrate browser nonce/pending observation, proof construction, direct submission and bounded retries; continue separate output/accounting fixes |
| Hours 14–26 | Complete browser private-output withdrawal; two-browser contention, empty-paymaster and failed-swap tests; rollback-aware receipts |
| Hours 26–36 | Complete browser deposit → private swap → withdrawal; recovery and receipt handling |
| Hours 36–42 | Adversarial/accounting tests, public deployment verification, demo rehearsals |
| Hours 42–48 | Scope freeze, reproducibility fixes, video, README, sponsor submission |

For a solo developer starting without a working note/proof foundation, this full scope is aggressive. Keep the Phase 0 and real-proof gates; reduce to one swap direction and one supported deposit size before reducing privacy correctness. Reuse public libraries and document them under the event's rules. Preparation should focus on learning and dependency experiments consistent with the chosen track, not misrepresenting pre-event product work.

If late, cut extra tokens, dynamic routing, note merging, private gas fees, extra sponsors, mobile polish, and generalized modules. Keep real proofs, real AMM settlement, backed notes, withdrawals, zero exchange allowances, and failure rollback.

After the hackathon, the next substantive work is sustainable private fee accounting that charges failed attempts safely, independent withdrawal funding, note merging/recovery improvements, better concurrency, stronger traffic privacy, and an external review of the circuits and contracts. None should be silently implied by the weekend demo.

**Next milestone:** Mine the existing private swap and withdrawal through the new automatic prefunded paymaster, without any sponsor signature. Then complete direct browser submission and demonstrate two browsers recovering from nonce contention with the sponsor/coordinator backend stopped. Preserve the reported lifecycle, attack, roundtrip and official-pair regressions; measure the complete prefix and both gas budgets. Public-network acceptance remains separate.
