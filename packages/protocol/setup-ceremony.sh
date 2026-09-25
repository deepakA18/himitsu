#!/usr/bin/env bash
# Groth16 setup for spend.circom.
#
# Entropy comes from the OS CSPRNG (`openssl rand`), never from the clock. A
# clock-derived contribution is guessable to within a few thousand candidates by
# anyone who knows roughly when the ceremony ran, and recovering any single
# contribution's randomness recovers the toxic waste for that contribution --
# which, in a one-contribution ceremony, is the whole trapdoor and lets the
# holder forge proofs for notes they never deposited.
#
# This is still a DEVELOPMENT ceremony: one contributor, one machine, and the
# entropy is discarded rather than ritually destroyed. It is unpredictable, not
# trustless. A production deployment needs a multi-party ceremony where at least
# one participant is honest.
set -euo pipefail
cd "$(dirname "$0")/circuits"
SNARKJS="$(cd .. && bun -e 'console.log(require.resolve("snarkjs/package.json").replace("package.json", "cli.js"))')"
POT=13

entropy() { openssl rand -hex 64; }

echo "==> powers of tau (2^$POT)"
node "$SNARKJS" powersoftau new bn128 $POT pot_0000.ptau -v > /dev/null
node "$SNARKJS" powersoftau contribute pot_0000.ptau pot_0001.ptau \
  --name="himitsu dev contribution" -e="$(entropy)" > /dev/null
node "$SNARKJS" powersoftau prepare phase2 pot_0001.ptau pot_final.ptau -v > /dev/null

echo "==> groth16 setup"
node "$SNARKJS" groth16 setup spend.r1cs pot_final.ptau spend_0000.zkey > /dev/null
node "$SNARKJS" zkey contribute spend_0000.zkey spend_final.zkey \
  --name="himitsu dev phase2" -e="$(entropy)" > /dev/null

echo "==> verify the zkey against the r1cs and ptau"
node "$SNARKJS" zkey verify spend.r1cs pot_final.ptau spend_final.zkey

node "$SNARKJS" zkey export verificationkey spend_final.zkey verification_key.json > /dev/null
node "$SNARKJS" zkey export solidityverifier spend_final.zkey SpendVerifier.sol > /dev/null
rm -f pot_0000.ptau pot_0001.ptau spend_0000.zkey
echo "==> done: spend_final.zkey, verification_key.json, SpendVerifier.sol"
