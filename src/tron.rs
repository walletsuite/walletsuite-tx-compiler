//! Tron transaction compilation.
//!
//! Builds `Transaction.raw_data` protobuf bytes and the SHA-256 signing hash
//! byte-for-byte deterministic under the Tron protocol spec.

use std::time::{SystemTime, UNIX_EPOCH};

use alloy_primitives::U256;
use sha2::{Digest, Sha256};

use crate::constants::{
    ERC20_TRANSFER_SELECTOR_BYTES, TRON_CONTRACT_TYPE_TRANSFER, TRON_CONTRACT_TYPE_TRIGGER_SMART,
};
use crate::error::{TxCompilerError, TxCompilerErrorCode};
use crate::tron_address::tron_address_to_bytes;
use crate::tron_proto::{
    encode_raw_data, encode_transfer_contract, encode_trigger_smart_contract, RawDataParams,
};
use crate::types::{
    Chain, CompilationMetadata, CompilationResult, CompileOptions, FeeMode, PreparedTransaction,
    TronBlockHeader, TxType,
};

/// Tron transaction expiration window: 10 hours in milliseconds.
const EXPIRATION_MS: u64 = 10 * 60 * 60 * 1000;

/// Byte length of the decoded Tron address (`0x41` prefix + 20-byte hash).
const TRON_ADDRESS_LEN: usize = 21;

/// Number of bytes from the start of `TronBlockHeader::h` (after hex decode)
/// used to derive `refBlockHash`. The slice `[8..16]` is taken.
const REF_BLOCK_HASH_START: usize = 8;
const REF_BLOCK_HASH_END: usize = 16;

/// Compile a validated Tron prepared transaction.
///
/// The returned `unsigned_tx` is the protobuf-encoded `Transaction.raw_data`
/// message. The `tx_hash` is its SHA-256 digest — sign the hash, then wrap
/// `raw_data` + signature into a full Tron transaction for broadcast.
pub fn compile_tron(
    prepared: &PreparedTransaction,
    options: CompileOptions,
) -> Result<CompilationResult, TxCompilerError> {
    let header = prepared.fee.rp.as_ref().ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Tron transactions require the block header at 'fee.rp'",
        )
    })?;

    let (ref_block_bytes, ref_block_hash) = derive_block_ref(header)?;
    let (contract, contract_type) = build_contract(prepared)?;
    let fee_limit = parse_fee_limit(prepared.fee.el.as_deref())?;

    // Tron transaction timestamps are creation-time, not block-time.
    // `expiration` is derived from the same base so `timestamp` and
    // `expiration` cannot drift apart regardless of how stale the
    // block header is. See the Tron protocol spec for `raw_data`.
    let timestamp_ms = options.now.unwrap_or_else(current_time_ms);
    let expiration = timestamp_ms.checked_add(EXPIRATION_MS).ok_or_else(|| {
        // Reachable only if a caller supplies `options.now` near
        // `u64::MAX`. Fail loudly rather than emit a nonsensical
        // year-584-million expiration via saturation.
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            "timestamp + EXPIRATION_MS overflows u64",
        )
    })?;

    let raw_data = encode_raw_data(&RawDataParams {
        ref_block_bytes: &ref_block_bytes,
        ref_block_hash: &ref_block_hash,
        expiration,
        timestamp: timestamp_ms,
        contract: &contract,
        fee_limit,
    });

    let mut hasher = Sha256::new();
    hasher.update(&raw_data);
    let hash = hasher.finalize();

    Ok(CompilationResult {
        chain: Chain::Tron,
        unsigned_tx: format!("0x{}", hex::encode(&raw_data)),
        tx_hash: format!("0x{}", hex::encode(hash)),
        metadata: CompilationMetadata {
            tx_type: prepared.tx_type,
            fee_mode: FeeMode::Tron,
            evm_tx_type: None,
            tron_contract_type: Some(contract_type),
            expiration: Some(expiration),
        },
    })
}

/// Derive the Tron `refBlockBytes` and `refBlockHash` values from the
/// block header.
///
/// - `refBlockBytes`: the low 16 bits of the block number, big-endian.
/// - `refBlockHash`: bytes `[8..16]` of the block ID hash.
fn derive_block_ref(header: &TronBlockHeader) -> Result<([u8; 2], [u8; 8]), TxCompilerError> {
    // `validate` enforces `h.len() == 64` (32 bytes). This is the
    // canonical Tron block-ID width; anything else is rejected.
    // We re-check defensively so that a `TronBlockHeader` constructed
    // outside `validate` (e.g. direct serde deserialise) cannot reach
    // the `h_bytes[8..16]` slice with a short buffer.
    if header.h.len() != 64 {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block ID (h) must be exactly 64 hex characters (32 bytes)",
        ));
    }

    let h_bytes = hex::decode(&header.h).map_err(|_| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block ID (h) must be valid hex",
        )
    })?;
    debug_assert_eq!(
        h_bytes.len(),
        32,
        "64 hex chars always decode to 32 bytes when hex::decode succeeds"
    );

    // `header.n & 0xffff` is always in 0..=u16::MAX, so `try_from`
    // is infallible; inline the expression to keep the block body
    // short and name-scoped to the result.
    let ref_block_bytes: [u8; 2] = u16::try_from(header.n & 0xffff)
        .expect("mask to 16 bits always fits in u16")
        .to_be_bytes();
    let mut ref_block_hash = [0_u8; 8];
    ref_block_hash.copy_from_slice(&h_bytes[REF_BLOCK_HASH_START..REF_BLOCK_HASH_END]);

    Ok((ref_block_bytes, ref_block_hash))
}

/// Parse `fee.el` (Tron energy fee limit in SUN) into an optional `u64`.
/// Returns `Ok(None)` when the caller omitted the field.
fn parse_fee_limit(el: Option<&str>) -> Result<Option<u64>, TxCompilerError> {
    el.map_or(Ok(None), |s| {
        s.parse::<u64>().map(Some).map_err(|_| {
            TxCompilerError::with_details(
                TxCompilerErrorCode::InvalidAmount,
                "Tron fee.el does not fit in u64",
                serde_json::json!({ "field": "el", "value": s }),
            )
        })
    })
}

/// Build the protobuf-encoded `Contract` message for the prepared intent,
/// returning the encoded bytes and the Tron contract-type discriminator.
fn build_contract(prepared: &PreparedTransaction) -> Result<(Vec<u8>, u8), TxCompilerError> {
    let from = tron_address_to_bytes(&prepared.from)?;
    match prepared.tx_type {
        TxType::TransferNative => {
            let to = tron_address_to_bytes(&prepared.to)?;
            let amount = prepared.value_wei.parse::<u64>().map_err(|_| {
                TxCompilerError::with_details(
                    TxCompilerErrorCode::InvalidAmount,
                    "Tron native amount does not fit in u64",
                    serde_json::json!({ "field": "valueWei", "value": prepared.value_wei }),
                )
            })?;
            Ok((
                encode_transfer_contract(&from, &to, amount),
                TRON_CONTRACT_TYPE_TRANSFER,
            ))
        }
        TxType::TransferToken => {
            let token = prepared.token_contract.as_deref().ok_or_else(|| {
                TxCompilerError::new(
                    TxCompilerErrorCode::InvalidPayload,
                    "Token transfer requires tokenContract",
                )
            })?;
            let token_bytes = tron_address_to_bytes(token)?;
            let data = build_trc20_transfer_data(&prepared.to, &prepared.value_wei)?;
            Ok((
                encode_trigger_smart_contract(&from, &token_bytes, &data),
                TRON_CONTRACT_TYPE_TRIGGER_SMART,
            ))
        }
    }
}

/// Build TRC-20 `transfer(address,uint256)` calldata.
///
/// Layout: 4-byte selector · 32-byte zero-padded address · 32-byte big-endian
/// amount (68 bytes total).
fn build_trc20_transfer_data(to: &str, amount: &str) -> Result<Vec<u8>, TxCompilerError> {
    let to_bytes = tron_address_to_bytes(to)?;
    if to_bytes.len() < TRON_ADDRESS_LEN {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidAddress,
            "Tron address decoded to fewer than 21 bytes",
        ));
    }
    // Drop the 0x41 prefix byte; ABI expects the 20-byte public-key hash.
    let address_bytes = &to_bytes[1..TRON_ADDRESS_LEN];

    let mut address_word = [0_u8; 32];
    address_word[12..32].copy_from_slice(address_bytes);

    let amount_u256 = U256::from_str_radix(amount, 10).map_err(|_| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAmount,
            "Amount exceeds uint256 range",
            serde_json::json!({ "value": amount }),
        )
    })?;
    let amount_word: [u8; 32] = amount_u256.to_be_bytes();

    let mut out = Vec::with_capacity(ERC20_TRANSFER_SELECTOR_BYTES.len() + 32 + 32);
    out.extend_from_slice(&ERC20_TRANSFER_SELECTOR_BYTES);
    out.extend_from_slice(&address_word);
    out.extend_from_slice(&amount_word);
    Ok(out)
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}
