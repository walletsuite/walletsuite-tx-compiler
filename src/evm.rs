//! EVM transaction compilation using alloy.
//!
//! Produces byte-exact signing pre-images (EIP-2718 canonical form) and
//! the corresponding keccak256 pre-image hash for the EIP-1559 (type 2)
//! and EIP-155 legacy envelopes.
//!
//! # Output contract
//!
//! `CompilationResult::unsigned_tx` is the SIGNING pre-image, not a
//! broadcastable signed transaction. To produce a broadcastable
//! transaction the caller must:
//!
//! 1. Compute (or consume) `tx_hash = keccak256(unsigned_tx)`.
//! 2. Sign the hash to get `(r, s, y_parity)`.
//! 3. Reconstruct the EIP-2718 envelope with the signature fields
//!    populated (use `alloy_consensus::TxEnvelope` or an equivalent
//!    library). Naively prepending the signature to the pre-image does
//!    NOT produce a valid wire transaction.
//!
//! Contract creation (`to = None` / `TxKind::Create`) is out of scope.
//! Every compiled transaction uses `TxKind::Call(to)`.

use alloy_consensus::{SignableTransaction, TxEip1559, TxLegacy};
use alloy_primitives::{Address, Bytes, TxKind, B256, U256};

use crate::constants::{EVM_TX_TYPE_EIP1559, EVM_TX_TYPE_LEGACY};
use crate::error::{TxCompilerError, TxCompilerErrorCode};
use crate::types::{Chain, CompilationMetadata, CompilationResult, FeeMode, PreparedTransaction};

/// Shared EVM fields derived from a prepared transaction before the
/// fee-mode branch picks its envelope.
struct EvmCommon {
    chain_id: u64,
    to: Address,
    value: U256,
    nonce: u64,
    gas_limit: u64,
    input_bytes: Bytes,
}

/// Compile a validated EVM prepared transaction.
///
/// Supports EIP-1559 (type 2) and Legacy (EIP-155, type 0) envelopes.
/// See the module-level docs for the meaning of `unsigned_tx` in the
/// returned result.
pub fn compile_evm(prepared: &PreparedTransaction) -> Result<CompilationResult, TxCompilerError> {
    let common = derive_common(prepared)?;
    let (bytes, hash, evm_tx_type) = match prepared.fee.mode {
        FeeMode::Eip1559 => encode_eip1559(prepared, &common)?,
        FeeMode::Legacy => encode_legacy(prepared, &common)?,
        FeeMode::Tron => {
            return Err(TxCompilerError::new(
                TxCompilerErrorCode::UnsupportedFeeMode,
                "Fee mode 'TRON' is not valid on Ethereum; use 'EIP1559' or 'LEGACY'",
            ));
        }
    };

    Ok(CompilationResult {
        chain: Chain::Ethereum,
        unsigned_tx: format!("0x{}", hex::encode(&bytes)),
        tx_hash: format!("0x{}", hex::encode(hash.as_slice())),
        metadata: CompilationMetadata {
            tx_type: prepared.tx_type,
            fee_mode: prepared.fee.mode,
            evm_tx_type: Some(evm_tx_type),
            tron_contract_type: None,
            expiration: None,
        },
    })
}

fn derive_common(prepared: &PreparedTransaction) -> Result<EvmCommon, TxCompilerError> {
    let chain_id = prepared.chain_id.ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::MissingFeeParams,
            "EVM transactions require chainId",
        )
    })?;
    let chain_id_u64 = u64::try_from(chain_id).map_err(|_| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            "EVM chainId must be a positive integer fitting in u64",
        )
    })?;
    if chain_id_u64 == 0 {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            "EVM chainId must be > 0",
        ));
    }

    let to = parse_address(&prepared.to, "to")?;
    let value = parse_u256(&prepared.value_wei, "valueWei")?;
    let nonce_str = prepared.nonce.as_deref().ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            "EVM transactions require nonce (enforced upstream by validate)",
        )
    })?;
    let nonce = parse_u64(nonce_str, "nonce")?;
    let gas_limit_str = prepared.fee.gas_limit.as_deref().ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::MissingFeeParams,
            "EVM transactions require gasLimit (enforced upstream by validate)",
        )
    })?;
    let gas_limit = parse_u64(gas_limit_str, "gasLimit")?;
    let input_bytes = decode_calldata(prepared.data.as_deref())?;

    Ok(EvmCommon {
        chain_id: chain_id_u64,
        to,
        value,
        nonce,
        gas_limit,
        input_bytes,
    })
}

fn decode_calldata(data: Option<&str>) -> Result<Bytes, TxCompilerError> {
    match data {
        Some(d) if !d.is_empty() && d != "0x" => {
            let decoded = hex::decode(d.strip_prefix("0x").unwrap_or(d)).map_err(|_| {
                TxCompilerError::new(
                    TxCompilerErrorCode::InvalidCalldata,
                    "Invalid hex in calldata",
                )
            })?;
            Ok(Bytes::from(decoded))
        }
        _ => Ok(Bytes::new()),
    }
}

fn encode_eip1559(
    prepared: &PreparedTransaction,
    common: &EvmCommon,
) -> Result<(Vec<u8>, B256, u8), TxCompilerError> {
    let max_fee_str = prepared.fee.max_fee_per_gas.as_deref().ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::MissingFeeParams,
            "EIP-1559 requires maxFeePerGas (enforced upstream by validate)",
        )
    })?;
    let max_fee = parse_u128(max_fee_str, "maxFeePerGas")?;
    let max_priority_str = prepared
        .fee
        .max_priority_fee_per_gas
        .as_deref()
        .ok_or_else(|| {
            TxCompilerError::new(
                TxCompilerErrorCode::MissingFeeParams,
                "EIP-1559 requires maxPriorityFeePerGas (enforced upstream by validate)",
            )
        })?;
    let max_priority = parse_u128(max_priority_str, "maxPriorityFeePerGas")?;
    #[allow(clippy::default_trait_access)]
    let tx = TxEip1559 {
        chain_id: common.chain_id,
        nonce: common.nonce,
        gas_limit: common.gas_limit,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_priority,
        to: TxKind::Call(common.to),
        value: common.value,
        access_list: Default::default(),
        input: common.input_bytes.clone(),
    };
    let mut buf = Vec::new();
    tx.encode_for_signing(&mut buf);
    Ok((buf, tx.signature_hash(), EVM_TX_TYPE_EIP1559))
}

fn encode_legacy(
    prepared: &PreparedTransaction,
    common: &EvmCommon,
) -> Result<(Vec<u8>, B256, u8), TxCompilerError> {
    let gas_price_str = prepared
        .fee
        .gas_price
        .as_deref()
        .or(prepared.fee.max_fee_per_gas.as_deref())
        .ok_or_else(|| {
            TxCompilerError::new(
                TxCompilerErrorCode::MissingFeeParams,
                "Legacy tx requires gasPrice (enforced upstream by validate)",
            )
        })?;
    let gas_price = parse_u128(gas_price_str, "gasPrice")?;
    let tx = TxLegacy {
        chain_id: Some(common.chain_id),
        nonce: common.nonce,
        gas_price,
        gas_limit: common.gas_limit,
        to: TxKind::Call(common.to),
        value: common.value,
        input: common.input_bytes.clone(),
    };
    let mut buf = Vec::new();
    tx.encode_for_signing(&mut buf);
    Ok((buf, tx.signature_hash(), EVM_TX_TYPE_LEGACY))
}

fn parse_address(s: &str, field: &str) -> Result<Address, TxCompilerError> {
    s.parse::<Address>().map_err(|_| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAddress,
            format!("Invalid EVM address in field '{field}'"),
            serde_json::json!({ "field": field, "address": s }),
        )
    })
}

fn parse_u256(s: &str, field: &str) -> Result<U256, TxCompilerError> {
    U256::from_str_radix(s, 10).map_err(|_| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAmount,
            format!("{field} is not a valid uint256"),
            serde_json::json!({ "field": field, "value": s }),
        )
    })
}

fn parse_u64(s: &str, field: &str) -> Result<u64, TxCompilerError> {
    s.parse::<u64>().map_err(|_| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAmount,
            format!("{field} does not fit in u64"),
            serde_json::json!({ "field": field, "value": s }),
        )
    })
}

fn parse_u128(s: &str, field: &str) -> Result<u128, TxCompilerError> {
    s.parse::<u128>().map_err(|_| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAmount,
            format!("{field} does not fit in u128 (EIP-1559 alloy limit)"),
            serde_json::json!({ "field": field, "value": s }),
        )
    })
}
