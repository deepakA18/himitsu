# Recovery phrase v1

New vaults generate a separate 24-word English BIP39 mnemonic (256 bits of entropy) locally using @scure/bip39 1.6.0. This is a Himitsu private-wallet phrase, not an Ethereum wallet import. Users save it offline once and re-enter it to confirm before creating deposits or swap outputs. The phrase is stored only inside the password-encrypted vault. Restore validates the checksum, requires empty storage, and permits a new local password.

## Stable derivation

BIP39 mnemonicToSeed uses the empty BIP39 passphrase. The local encryption password is never part of derivation. The 64-byte seed is imported as a non-exportable HMAC-SHA256 key and its temporary byte buffer is cleared. Each scalar is rejection-sampled below the circuit scalar field from HMAC of UTF-8 JSON:

`["himitsu-notes:v1", deployment.toLowerCase(), pool.toLowerCase(), counter, label, retry]`

Labels are `nullifier` and `secret`; retry starts at zero for each field. Commitments and nullifier hashes retain the existing Poseidon circuit format. This domain and serialization must remain unchanged for v1. Changing them requires an explicit new recovery version and support for old versions.

## Discovery and counters

The browser scans all 1,024 supported counter slots per pool, including gaps, and matches candidates locally against canonical Deposit events. Only matching notes have spent status queried. Event tree roots, deployment identity, and the scan block hash are checked against the node. Two successor blocks are required, as in the existing client. This is the MVP confirmation policy, not finality.

Allocation advances beyond the highest locally saved or recovered counter. Draft outputs are saved before proving, so failed attempts can consume slots. Exhaustion fails explicitly at 1,024 slots; it never creates an unrecoverable higher counter. This bounded limit matches the current pool tree capacity but failed attempts can exhaust a phrase's slots earlier. The same phrase has separate counter spaces in each pool. Candidate derivations are cached in memory for the unlocked controller; no hosted indexer is required.

## Scope and limitations

- The phrase restores confirmed new deposits and swap output notes, including spent status. It does not reconstruct the old transaction journal or recover pending raw transactions, legacy random notes, or local test-wallet keys.
- Legacy vaults can enable a phrase for future notes without deleting existing notes. Preserve their encrypted backup until legacy funds have been withdrawn or moved into recoverable notes.
- Use one active browser per phrase. Web Locks and revision checks cover tabs in one origin, not independent devices. After loss of local state, unknown pending transactions and unmined counters cannot be reconstructed from commitments alone. Allow previous activity to settle before restoring and transacting; do not use restoration to retry an uncertain transaction immediately. Onchain duplicate commitments and spent-nullifier checks still apply.
- A valid wrong phrase produces no matching notes; zero matches cannot authenticate ownership. The UI mentions wrong deployment and unconfirmed deposits as other possibilities. Recover against the original deployment; resetting the devnet destroys the chain data required by recovery.
- Anyone holding the phrase can spend all derived notes. Malicious code in an unlocked page can access its secrets. This implementation remains a local test MVP with the existing development ceremony and sponsor subsidy.

## Validation

`bun run check` covers checksums, normalization, a pinned derivation vector, pool/deployment/counter separation, the last supported slot, full scans across gaps, exhaustion, password independence, no-overwrite restore, encryption, and legacy preservation.

`bun run test:client` runs against the existing Ethrex app deployment with real Groth16 proofs. It reserves unmined drafts, deposits at counter 32, swaps to output counter 64, restores only the phrase into an empty vault with a new password, discovers exactly the two mined notes with correct spent state, and withdraws the recovered output. The same run tests competing pool nonces and an accepted transaction whose RPC response was lost.
