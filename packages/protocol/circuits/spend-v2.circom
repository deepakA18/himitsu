// Himitsu v2: commitment = Poseidon(Poseidon(nullifier, secret), amount).
// The public spend amount is proved, preventing withdrawals exceeding note value.
pragma circom 2.0.0;

include "poseidon.circom";
include "bitify.circom";

// The Himitsu spend circuit: a Tornado-style shielded note.
//
//   commitment    = Poseidon(nullifier, secret)      the leaf in the pool's tree
//   nullifierHash = Poseidon(nullifier)              published once, on spend
//
// Proving a spend means showing three things at once:
//   1. knowledge of (nullifier, secret) opening some commitment  -- ownership
//   2. that commitment sits in the tree under `root`             -- membership
//   3. nullifierHash is the one derived from that nullifier      -- double-spend
//
// The pool keeps a set of spent nullifierHashes, so a second spend of the same
// note publishes the same nullifierHash and is refused -- without ever revealing
// WHICH leaf was spent, because the path is private.

template CommitmentHasher() {
    signal input nullifier;
    signal input secret;
    signal output commitment;
    signal output nullifierHash;

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitment <== commitmentHasher.out;

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;
}

// Swap the pair (in[0], in[1]) when s == 1, keeping both branches arithmetic.
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0; // s is a bit

    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].out;
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];
    }

    root === hashers[levels - 1].out;
}

template Spend(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    // The transaction digest as two 128-bit limbs. One field element cannot
    // carry a 256-bit digest: sig_hash is 256 bits and the BN254 scalar field is
    // ~254, so reducing mod r maps about four fifths of digests onto a smaller
    // value and distinct transactions can share a signal. Splitting keeps the
    // binding injective over the whole digest.
    signal input txHashHi;
    signal input txHashLo;
    // private
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hasher = CommitmentHasher();
    hasher.nullifier <== nullifier;
    hasher.secret <== secret;
    hasher.nullifierHash === nullifierHash;

    component tree = MerkleTreeChecker(levels);
    component amountCommitment = Poseidon(2);
    amountCommitment.inputs[0] <== hasher.commitment;
    amountCommitment.inputs[1] <== amount;
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    tree.leaf <== amountCommitment.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // `recipient` and the digest limbs constrain nothing about the note -- they
    // are here to be BOUND. A public signal that appears in no constraint gets an
    // identity IC point, so vk_x would not depend on it and a proof would verify
    // against any recipient or any transaction. Squaring is the standard circom
    // idiom for forcing a signal into the constraint system.
    signal recipientSquare;
    recipientSquare <== recipient * recipient;

    // Range-constrain each limb to 128 bits. The verifying contract derives the
    // limbs from TXPARAM(sig_hash) itself, so it can only ever pass well-formed
    // ones; these make the statement self-contained anyway -- the proof asserts
    // the digest is exactly txHashHi * 2^128 + txHashLo, whoever supplies it.
    component hiBits = Num2Bits(128);
    component loBits = Num2Bits(128);
    hiBits.in <== txHashHi;
    loBits.in <== txHashLo;
}

component main {public [root, nullifierHash, recipient, txHashHi, txHashLo, amount]} = Spend(10);
