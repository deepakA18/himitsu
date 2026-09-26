# Portable private-note flow

The main UI uses Deposit / Swap / Withdraw. The legacy phrase-recovery page has been removed; the app accepts private-note files only. No contract, circuit, or Ethrex changes are needed for this flow.

## Format and ownership

`himitsu-note-v1:<JSON array>:<keccak256 checksum>`

The array contains chain ID, genesis hash, deployment identity, note version, pool address, nullifier, and secret. These are not Tornado Cash notes and are not interoperable with Tornado Cash. Files are bounded to 4096 characters, validated against the selected trusted deployment, and checked for field and checksum validity. The checksum detects accidental damage; it does not authenticate the person supplying a file or prove funds exist. Only canonical events and spent-nullifier checks establish spendability.

A file is unencrypted and grants spending authority. It is not a receipt safe to share. No secret is placed in a URL or sent to a server. The browser supplies only commitments, proofs, and public transaction data to RPC.

V2 files intentionally omit the amount: the base commitment identifies a canonical DepositV2 event, and the scanner verifies the amount-bound commitment. Consequently, an output file exported before a swap remains usable after any valid execution price. Swap failure creates no output note onchain; the saved output file then controls no funds. Keep the input file until confirmation.

## Persistence

Random note secrets replace phrase derivation for new private-note actions. A domain-separated hash of the note's two secrets and deployment/pool binding unlocks an AES-GCM encrypted cache through the existing PBKDF2 encryption implementation. Each source note has its own IndexedDB database. The cache stores the journal, including the signed raw transaction, and its output note secrets. Re-importing that source note in the same browser restores uncertain submission records without a user password. Original phrase vault storage is untouched.

The UI requires downloading the newly generated file and explicitly confirming it is saved before calling the deposit wallet or preparing/submitting a swap. Browsers cannot verify that a downloaded file was actually retained; the confirmation belongs to the user. Cancellation sends no transaction. Rejected/stale attempts require explicit retries with a newly saved output file.

Clearing browser data loses local pending history. The input/output files independently recover confirmed funds from canonical chain events, not pending transactions. A lost file may still be downloadable from its unlocked source cache, but that cache is not a substitute for the saved files. Use one active browser per note; independent devices cannot coordinate local journals. There is no automatic resubmission.

## Verification

- Unit checks cover file round trips, deployment/version binding, damaged files, amount-independent output recovery material, and encrypted cache reopening from a note alone.
- `bun run test:private-notes` uses the deployed local Ethrex chain and real Groth16 proofs: saved input file → deposit → fresh-cache import → swap with simulated lost accepted RPC response → encrypted journal reopen using only the source note → fresh output-file import → exact-amount withdrawal → spent-note checks.
- Public transaction evidence goes to `deployments/private-note-evidence.json`; note secrets are not written there.
- UI visual verification is intentionally left to the user. Run `bun run dev`, open http://127.0.0.1:3000, and test the three tabs. Use an injected wallet funded with local test ETH on the RPC in Pool details.
