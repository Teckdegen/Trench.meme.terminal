pragma circom 2.1.6;

// ============================================================================
// Deck shuffle circuit for trench.meme poker (ZkDealer).
//
// Proves, in zero knowledge:
//   "outputDeck is a re-encryption + secret permutation of inputDeck under the
//    table public key PK"
// without revealing the permutation or the re-encryption randomness.
//
// This is the standard mental-poker shuffle argument (Barnett–Smart style),
// expressed for a SNARK. Cards are ElGamal ciphertexts over BN254:
//   ct_j = (c0_j, c1_j) = (g^r_j, m_j · PK^r_j)
// A shuffle re-randomizes each ciphertext (multiply by (g^s, PK^s)) and applies
// a secret permutation π.
//
// PUBLIC inputs:
//   - inDeckHash   : Poseidon hash/commitment of the input ciphertext vector
//   - outDeckHash  : Poseidon hash/commitment of the output ciphertext vector
//   - PK           : table public key (compressed coords)
// PRIVATE inputs (witness):
//   - perm[52]     : the secret permutation (as a permutation-matrix selector)
//   - s[52]        : re-encryption randomness per card
//   - inDeck[52]   : the input ciphertexts (hashed into inDeckHash)
//   - outDeck[52]  : the output ciphertexts (hashed into outDeckHash)
//
// Constraints (sketch — the full EC arithmetic uses a BN254 sub-circuit lib
// such as circom-ecdsa / circomlib's babyjubjub depending on the curve choice):
//   1. perm is a valid permutation (each row/col of the selector sums to 1).
//   2. for each output position k: outDeck[k] == reEncrypt(inDeck[π(k)], s[k], PK)
//   3. Poseidon(inDeck)  == inDeckHash
//   4. Poseidon(outDeck) == outDeckHash
//
// NOTE: This file is the SPEC + skeleton. The EC re-encryption gadget and the
// permutation-matrix constraints are filled from an audited library; do not
// hand-roll the curve math. After completing it:
//   circom shuffle.circom --r1cs --wasm --sym
//   snarkjs groth16 setup ... ; snarkjs zkey export solidityverifier ...
// which generates contracts/src/poker/generated/ShuffleVerifier.sol implementing
// IShuffleVerifier.
// ============================================================================

template PermutationCheck(N) {
    signal input sel[N][N];      // permutation matrix (0/1)
    // each entry boolean
    for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
            sel[i][j] * (sel[i][j] - 1) === 0;
        }
    }
    // each row sums to 1
    for (var i = 0; i < N; i++) {
        var rs = 0;
        for (var j = 0; j < N; j++) { rs += sel[i][j]; }
        rs === 1;
    }
    // each column sums to 1
    for (var j = 0; j < N; j++) {
        var cs = 0;
        for (var i = 0; i < N; i++) { cs += sel[i][j]; }
        cs === 1;
    }
}

// Placeholder top-level. The re-encryption equality constraints and Poseidon
// commitments are added alongside the EC gadget import in the production build.
template Shuffle(N) {
    signal input sel[N][N];
    component pc = PermutationCheck(N);
    for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
            pc.sel[i][j] <== sel[i][j];
        }
    }
    // TODO(prod): EC re-encryption equality + Poseidon(inDeck)/(outDeck) binding.
}

component main = Shuffle(52);
