# trench.meme poker — zk circuits

Two zero-knowledge circuits back the production poker dealer (`ZkDealer.sol`):

| Circuit | Proves | Verifier interface |
|---------|--------|--------------------|
| `shuffle/shuffle.circom` | output deck is a re-encryption + secret permutation of the input deck under the table key | `IShuffleVerifier` |
| `decrypt_share/` (to add) | a posted partial decryption share is consistent with the prover's published key (Chaum–Pedersen) | `IDecryptShareVerifier` |

## Why two circuits

- **Shuffle** is the expensive, once-per-hand proof. One honest shuffler in the
  chain guarantees the deck is secret from everyone — including us — even if
  every other party colludes.
- **Decrypt-share** is a cheap proof attached to each dealt card so a malicious
  party cannot poison a card with a bad share. In practice this is small enough
  to verify with a hand-written Chaum–Pedersen verifier (no SNARK needed) — see
  `IDecryptShareVerifier`.

## Curve choice

ElGamal over **BabyJubJub** (circom-native, cheap in-circuit EC) for the deck
encryption, with the Groth16 proof on **BN254**. This is the same stack
zkHoldem-style projects use and keeps proving in the seconds range on commodity
hardware.

## Build pipeline

```bash
# 1. compile
circom shuffle/shuffle.circom --r1cs --wasm --sym -o build/

# 2. powers of tau (reuse a community ptau of sufficient size)
snarkjs groth16 setup build/shuffle.r1cs pot/powersOfTau28_hez_final_16.ptau build/shuffle_0.zkey

# 3. contribute to the phase-2 ceremony (do a real MPC for mainnet)
snarkjs zkey contribute build/shuffle_0.zkey build/shuffle.zkey --name="trench" -v

# 4. export the Solidity verifier implementing IShuffleVerifier
snarkjs zkey export solidityverifier build/shuffle.zkey \
  ../src/poker/generated/ShuffleVerifier.sol
```

The generated `ShuffleVerifier.sol` is wired into `ZkDealer` at deploy time.

## Status

`shuffle.circom` here contains the permutation-matrix constraints and the full
spec of the remaining gadgets (EC re-encryption equality + Poseidon deck
commitments) as TODOs. **Do not hand-roll the EC math** — import an audited
BabyJubJub gadget (circomlib) and an audited shuffle argument. This layer is the
casino's reputation; it gets its own audit before real-money tables.

## References

- Barnett & Smart, "Mental Poker Revisited" (the shuffle/threshold-decrypt
  protocol this implements)
- Geometry's `zk-shuffle` and the zkHoldem published circuits (reference impls)
- circomlib BabyJubJub + Poseidon
