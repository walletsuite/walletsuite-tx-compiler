# WalletSuite Transaction Compiler

> Deterministic EVM and Tron unsigned-transaction compilation for Rust.

Crate name: **`walletsuite-tx-compiler`**

[![CI](https://github.com/walletsuite/walletsuite-tx-compiler/actions/workflows/ci.yml/badge.svg)](https://github.com/walletsuite/walletsuite-tx-compiler/actions/workflows/ci.yml)
[![Crates.io](https://img.shields.io/crates/v/walletsuite-tx-compiler.svg)](https://crates.io/crates/walletsuite-tx-compiler)
[![Docs.rs](https://docs.rs/walletsuite-tx-compiler/badge.svg)](https://docs.rs/walletsuite-tx-compiler)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![MSRV](https://img.shields.io/badge/MSRV-1.91-orange.svg)](Cargo.toml)

Deterministic transaction compilation for Ethereum (EVM) and Tron. Converts a
canonical `PreparedTransaction` payload into the signing pre-image bytes
and the corresponding pre-image digest a hardware wallet / HSM / signing
service can sign. Output is byte-exact and stable across versions; every
fixture case in [`tests/fixtures/canonical.json`](tests/fixtures/canonical.json)
is verified on every CI run.

## Design goals

- **Byte-exact determinism.** Compiled output (unsigned tx bytes, pre-image
  hash, metadata, review) is stable for every payload in
  [`tests/fixtures/canonical.json`](tests/fixtures/canonical.json). Any change
  that alters compiled bytes must update that fixture in the same PR and
  is treated as a hard regression by CI.
- **No surprises at the boundary.** Payloads are validated against the
  full canonical invariant set (address shape, safe integer ranges,
  mode-specific fee fields, EIP-155 chain-id, Tron block header, ERC-20
  calldata selector with the 20-byte embedded recipient, 0x41 Tron
  address prefix) before any irreversible work runs.
- **Pure library.** Does not sign, broadcast, fetch nonces, or read
  wallets. Output is the signing pre-image + its hash; the caller drives
  the signer.
- **Semver-stable.** Every public struct and enum is `#[non_exhaustive]`;
  adding fields or variants is non-breaking. Construct via serde or the
  provided builder (`CompileOptions::new().with_now(...)`), never via
  struct literals.
- **No-unsafe.** `unsafe_code = "forbid"`. Clippy `pedantic`, `nursery`,
  and `cargo` lint groups enabled.
- **Small dependency surface.** [`alloy-consensus`](https://docs.rs/alloy-consensus)
  for EVM RLP + signature hashing, [`bs58`](https://docs.rs/bs58) for
  Tron base58check, [`sha2`](https://docs.rs/sha2) for Tron hashing, and
  a hand-rolled protobuf encoder for `Transaction.raw_data`.

## Supported transaction shapes

| Chain    | Intent              | Envelope                        |
|----------|---------------------|----------------------------------|
| EVM      | `TRANSFER_NATIVE`   | EIP-1559 (type 2) or legacy EIP-155 |
| EVM      | `TRANSFER_TOKEN`    | ERC-20 `transfer(address,uint256)`  |
| Tron     | `TRANSFER_NATIVE`   | `TransferContract` (type 1)         |
| Tron     | `TRANSFER_TOKEN`    | `TriggerSmartContract` (type 31), TRC-20 `transfer` |

## Install

```toml
[dependencies]
walletsuite-tx-compiler = "0.1"
```

## Usage

```rust
use walletsuite_tx_compiler::{compile, review, validate, CompileOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let raw: serde_json::Value = serde_json::from_str(r#"{
        "chain": "ethereum",
        "chainId": 1,
        "txType": "TRANSFER_NATIVE",
        "from": "0x1111111111111111111111111111111111111111",
        "to":   "0x2222222222222222222222222222222222222222",
        "valueWei": "1000000000000000000",
        "nonce": "0",
        "fee": {
            "mode": "EIP1559",
            "gasLimit": "21000",
            "maxFeePerGas": "30000000000",
            "maxPriorityFeePerGas": "1500000000"
        }
    }"#)?;

    let prepared = validate(&raw)?;
    let human_review = review(&prepared)?;
    let result = compile(&prepared, CompileOptions::default())?;

    // EIP-1559 signing pre-image starts with the 0x02 envelope byte.
    assert!(result.unsigned_tx.starts_with("0x02"));

    println!("{human_review:#?}");
    println!("digest to sign: {}", result.tx_hash);

    // Sign `result.tx_hash` with your HSM / hardware wallet / signer, then
    // reconstruct the signed wire transaction via
    // `alloy_consensus::TxEnvelope` (EVM) or by wrapping the Tron
    // `raw_data` + signature in the outer `Transaction` protobuf.
    Ok(())
}
```

### Reproducible Tron output

Tron `timestamp` and `expiration` default to `SystemTime::now()`, so
compiled bytes vary per call. For byte-exact reproducibility, pin the
wall clock (milliseconds since epoch):

```rust
let options = CompileOptions::new().with_now(1_710_000_000_000);
let result = compile(&prepared, options)?;
```

## Output contract

Per-chain semantics of `CompilationResult::unsigned_tx`:

- **EVM:** the EIP-2718 signing pre-image
  (`0x02 || rlp([...])` for EIP-1559; `rlp([..., chainId, 0, 0])` for
  legacy EIP-155). The caller hashes with keccak256 (already provided
  as `tx_hash`), signs the hash, and reconstructs the signed envelope
  via `alloy_consensus::TxEnvelope` or an equivalent library.
- **Tron:** the protobuf-encoded `Transaction.raw_data` bytes. The
  caller hashes with SHA-256 (already provided as `tx_hash`), signs
  the hash, and wraps `raw_data` + signature into the outer Tron
  `Transaction` message to broadcast.

## Determinism guarantee

`tests/canonical.rs` iterates every case in `tests/fixtures/canonical.json`
and asserts four invariants per case:

1. `unsigned_tx` matches the pinned hex byte-for-byte.
2. `tx_hash` matches the expected keccak256 (EVM) or SHA-256 (Tron)
   pre-image digest.
3. `metadata` serializes to identical JSON (same field set, same key order).
4. `review` serializes to identical JSON.

If you change any code path that alters compiled bytes, update the
fixture in the same PR — otherwise CI will block the merge.

## Non-goals

- This crate does **not** manage keys, sign transactions, fetch nonces, or
  broadcast. Pair it with a signer (hardware wallet, HSM, signing service)
  and a node client.
- Chains other than Ethereum (EVM-compatible) and Tron are out of scope
  for this release.

## Development

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo doc --all-features --no-deps
```

CI runs all of the above on Linux, macOS, and Windows, plus
`cargo audit` and a compile-only MSRV check (`cargo check`) against
Rust 1.91.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately to
`security@walletsuite.io`.
