//! Runtime validation of raw prepared-transaction JSON into a typed
//! [`PreparedTransaction`].
//!
//! The validator enforces the canonical `PreparedTransaction` invariants
//! so any payload it accepts can be safely passed to `compile()` without
//! triggering panics or partial encodes. Numeric fields that may arrive
//! as JSON `number` are coerced to canonical decimal strings.

use serde_json::{Map, Value};

use crate::constants::{ERC20_TRANSFER_CALLDATA_HEX_LEN, ERC20_TRANSFER_SELECTOR_HEX};
use crate::error::{TxCompilerError, TxCompilerErrorCode};
use crate::tron_address::tron_address_to_bytes;
use crate::types::{Chain, FeeMode, FeeParams, PreparedTransaction, TronBlockHeader, TxType};

const EVM_ADDRESS_LEN: usize = 42;
/// JavaScript safe integer ceiling (`2^53 − 1`), used for EVM nonce bounds.
const MAX_SAFE_JS_INT: u64 = (1 << 53) - 1;
/// Upper bound on the informational Tron block-header fields
/// (`p` / `r` / `w`). 128 bytes comfortably covers any real hex hash
/// or base58 address; anything longer is payload abuse.
const MAX_INFO_FIELD_LEN: usize = 128;

/// Validate an arbitrary JSON payload into a [`PreparedTransaction`].
///
/// Rejects malformed payloads with stable error codes before any
/// irreversible work reaches `compile()`.
pub fn validate(input: &Value) -> Result<PreparedTransaction, TxCompilerError> {
    let obj = input
        .as_object()
        .ok_or_else(|| invalid_payload("Expected a non-null object"))?;

    let chain = require_chain(obj)?;
    let tx_type = require_tx_type(obj)?;
    let from = require_non_empty_string(obj, "from")?;
    let to = require_non_empty_string(obj, "to")?;
    let value_wei = require_int_string(obj, "valueWei")?;
    let data = optional_string(obj, "data");
    let token_contract = optional_string(obj, "tokenContract");
    let chain_id = optional_number(obj, "chainId");
    let nonce = optional_int_string(obj, "nonce")?;
    let fee = validate_fee(obj.get("fee"), chain)?;

    match chain {
        Chain::Ethereum => validate_evm_fields(
            chain_id,
            nonce.as_deref(),
            &from,
            &to,
            token_contract.as_deref(),
        )?,
        Chain::Tron => validate_tron_fields(&from, &to, token_contract.as_deref())?,
    }

    if tx_type == TxType::TransferNative && chain == Chain::Ethereum {
        if let Some(ref d) = data {
            if !d.is_empty() && d != "0x" {
                return Err(TxCompilerError::with_details(
                    TxCompilerErrorCode::InvalidPayload,
                    "EVM TRANSFER_NATIVE must not carry calldata",
                    serde_json::json!({ "dataLength": d.len() }),
                ));
            }
        }
    }

    if tx_type == TxType::TransferToken {
        let token = token_contract.as_deref().ok_or_else(|| {
            TxCompilerError::new(
                TxCompilerErrorCode::InvalidPayload,
                "TRANSFER_TOKEN requires tokenContract",
            )
        })?;

        if chain == Chain::Ethereum {
            validate_evm_token_transfer(data.as_deref(), &to, token, &value_wei)?;
        }
    }

    Ok(PreparedTransaction {
        chain,
        chain_id,
        from,
        to,
        value_wei,
        data,
        tx_type,
        token_contract,
        nonce,
        fee,
    })
}

// ---------------------------------------------------------------------------
// Top-level enum helpers
// ---------------------------------------------------------------------------

fn require_chain(obj: &Map<String, Value>) -> Result<Chain, TxCompilerError> {
    match obj.get("chain").and_then(Value::as_str) {
        Some("ethereum") => Ok(Chain::Ethereum),
        Some("tron") => Ok(Chain::Tron),
        other => Err(TxCompilerError::new(
            TxCompilerErrorCode::UnsupportedChain,
            format!("Invalid chain: {}", display_value(other)),
        )),
    }
}

fn require_tx_type(obj: &Map<String, Value>) -> Result<TxType, TxCompilerError> {
    match obj.get("txType").and_then(Value::as_str) {
        Some("TRANSFER_NATIVE") => Ok(TxType::TransferNative),
        Some("TRANSFER_TOKEN") => Ok(TxType::TransferToken),
        other => Err(TxCompilerError::new(
            TxCompilerErrorCode::UnsupportedTxType,
            format!("Invalid txType: {}", display_value(other)),
        )),
    }
}

fn require_fee_mode(obj: &Map<String, Value>) -> Result<FeeMode, TxCompilerError> {
    match obj.get("mode").and_then(Value::as_str) {
        Some("EIP1559") => Ok(FeeMode::Eip1559),
        Some("LEGACY") => Ok(FeeMode::Legacy),
        Some("TRON") => Ok(FeeMode::Tron),
        other => Err(TxCompilerError::new(
            TxCompilerErrorCode::UnsupportedFeeMode,
            format!("Invalid mode: {}", display_value(other)),
        )),
    }
}

fn display_value(v: Option<&str>) -> String {
    v.map_or_else(|| "(missing)".to_string(), ToString::to_string)
}

// ---------------------------------------------------------------------------
// Chain-specific address validation
// ---------------------------------------------------------------------------

fn validate_evm_fields(
    chain_id: Option<i64>,
    nonce: Option<&str>,
    from: &str,
    to: &str,
    token_contract: Option<&str>,
) -> Result<(), TxCompilerError> {
    match chain_id {
        Some(id) if id >= 1 => {}
        other => {
            return Err(TxCompilerError::with_details(
                TxCompilerErrorCode::InvalidPayload,
                "EVM chainId must be a positive integer",
                serde_json::json!({ "chainId": other }),
            ));
        }
    }

    let nonce = nonce.ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            "EVM transactions require nonce",
        )
    })?;
    match nonce.parse::<u64>() {
        Ok(n) if n <= MAX_SAFE_JS_INT => {}
        _ => {
            return Err(TxCompilerError::with_details(
                TxCompilerErrorCode::InvalidPayload,
                "EVM nonce exceeds safe integer range (max 2^53 - 1)",
                serde_json::json!({ "nonce": nonce }),
            ));
        }
    }

    validate_evm_address(from, "from")?;
    validate_evm_address(to, "to")?;
    if let Some(tc) = token_contract {
        validate_evm_address(tc, "tokenContract")?;
    }
    Ok(())
}

fn validate_tron_fields(
    from: &str,
    to: &str,
    token_contract: Option<&str>,
) -> Result<(), TxCompilerError> {
    validate_tron_address(from, "from")?;
    validate_tron_address(to, "to")?;
    if let Some(tc) = token_contract {
        validate_tron_address(tc, "tokenContract")?;
    }
    Ok(())
}

fn validate_evm_address(address: &str, field: &str) -> Result<(), TxCompilerError> {
    if address.len() != EVM_ADDRESS_LEN {
        return Err(invalid_address_for(field, address));
    }
    if !address.starts_with("0x") {
        return Err(invalid_address_for(field, address));
    }
    if !address[2..].bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid_address_for(field, address));
    }
    Ok(())
}

fn validate_tron_address(address: &str, field: &str) -> Result<(), TxCompilerError> {
    tron_address_to_bytes(address)
        .map(|_| ())
        .map_err(|_| invalid_address_for(field, address))
}

fn invalid_address_for(field: &str, address: &str) -> TxCompilerError {
    // Keep the raw address out of the human-readable message text; put
    // it in `details` only, where log redaction is callers' choice.
    TxCompilerError::with_details(
        TxCompilerErrorCode::InvalidAddress,
        format!("Invalid address in '{field}'"),
        serde_json::json!({ "field": field, "address": address }),
    )
}

// ---------------------------------------------------------------------------
// EVM TRANSFER_TOKEN shape validation
// ---------------------------------------------------------------------------

fn validate_evm_token_transfer(
    data: Option<&str>,
    to: &str,
    token_contract: &str,
    value_wei: &str,
) -> Result<(), TxCompilerError> {
    let data = match data {
        Some(d) if !d.is_empty() && d != "0x" => d,
        _ => {
            return Err(TxCompilerError::new(
                TxCompilerErrorCode::InvalidPayload,
                "EVM TRANSFER_TOKEN requires calldata",
            ));
        }
    };

    let hex = data.strip_prefix("0x").unwrap_or(data);

    if !is_hex(hex) {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            "EVM TRANSFER_TOKEN calldata contains non-hex characters",
        ));
    }

    if hex.len() != ERC20_TRANSFER_CALLDATA_HEX_LEN {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidCalldata,
            format!(
                "EVM TRANSFER_TOKEN calldata must be exactly 68 bytes (got {})",
                hex.len() / 2
            ),
            serde_json::json!({
                "length": hex.len(),
                "expected": ERC20_TRANSFER_CALLDATA_HEX_LEN
            }),
        ));
    }

    let selector = hex[0..8].to_ascii_lowercase();
    if selector != ERC20_TRANSFER_SELECTOR_HEX {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            format!(
                "Expected ERC-20 transfer selector {ERC20_TRANSFER_SELECTOR_HEX}, got {selector}"
            ),
        ));
    }

    // Validate the 20-byte embedded recipient. An ERC-20 transfer
    // calldata word layout is:
    //   [0..8]   selector
    //   [8..72]  32-byte zero-padded address (leading 24 hex chars must be 0)
    //   [72..136] 32-byte big-endian amount
    // The first 24 chars of the address word must be zero; the last 40
    // chars are the actual 20-byte address.
    let address_word = &hex[8..72];
    if !address_word[..24].bytes().all(|b| b == b'0') {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            "ERC-20 transfer recipient word must be left-zero-padded",
        ));
    }
    let embedded_address = format!("0x{}", &address_word[24..]);
    validate_evm_address(&embedded_address, "data.recipient")?;

    if !to.eq_ignore_ascii_case(token_contract) {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidPayload,
            "EVM TRANSFER_TOKEN: to must equal tokenContract",
            serde_json::json!({ "to": to, "tokenContract": token_contract }),
        ));
    }

    if value_wei != "0" {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidPayload,
            "EVM TRANSFER_TOKEN: valueWei must be 0",
            serde_json::json!({ "valueWei": value_wei }),
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Fee validation
// ---------------------------------------------------------------------------

fn validate_fee(raw: Option<&Value>, chain: Chain) -> Result<FeeParams, TxCompilerError> {
    let obj = raw.and_then(Value::as_object).ok_or_else(|| {
        TxCompilerError::new(TxCompilerErrorCode::MissingFeeParams, "Missing fee object")
    })?;

    let mode = require_fee_mode(obj)?;

    match (chain, mode) {
        (Chain::Ethereum, FeeMode::Tron) => {
            return Err(TxCompilerError::new(
                TxCompilerErrorCode::UnsupportedFeeMode,
                "Fee mode 'TRON' is not valid on Ethereum; use 'EIP1559' or 'LEGACY'",
            ));
        }
        (Chain::Tron, FeeMode::Eip1559 | FeeMode::Legacy) => {
            return Err(TxCompilerError::new(
                TxCompilerErrorCode::UnsupportedFeeMode,
                format!(
                    "Fee mode '{}' is not valid on Tron; use 'TRON'",
                    mode.as_str(),
                ),
            ));
        }
        _ => {}
    }

    let gas_limit = optional_int_string(obj, "gasLimit")?;
    let base_fee_per_gas = optional_int_string(obj, "baseFeePerGas")?;
    let max_priority_fee_per_gas = optional_int_string(obj, "maxPriorityFeePerGas")?;
    let max_fee_per_gas = optional_int_string(obj, "maxFeePerGas")?;
    let gas_price = optional_int_string(obj, "gasPrice")?;
    let el = optional_int_string(obj, "el")?;
    let rp = optional_block_header(obj.get("rp"))?;

    match mode {
        FeeMode::Eip1559 => {
            if gas_limit.is_none() {
                return Err(TxCompilerError::new(
                    TxCompilerErrorCode::MissingFeeParams,
                    "EIP-1559 requires gasLimit",
                ));
            }
            if max_fee_per_gas.is_none() || max_priority_fee_per_gas.is_none() {
                return Err(TxCompilerError::new(
                    TxCompilerErrorCode::MissingFeeParams,
                    "EIP-1559 requires maxFeePerGas and maxPriorityFeePerGas",
                ));
            }
        }
        FeeMode::Legacy => {
            if gas_limit.is_none() {
                return Err(TxCompilerError::new(
                    TxCompilerErrorCode::MissingFeeParams,
                    "LEGACY requires gasLimit",
                ));
            }
            if gas_price.is_none() && max_fee_per_gas.is_none() {
                return Err(TxCompilerError::new(
                    TxCompilerErrorCode::MissingFeeParams,
                    "LEGACY requires gasPrice or maxFeePerGas",
                ));
            }
        }
        FeeMode::Tron => {
            if rp.is_none() {
                return Err(TxCompilerError::new(
                    TxCompilerErrorCode::InvalidBlockHeader,
                    "Fee mode 'TRON' requires the block-header field 'fee.rp'",
                ));
            }
        }
    }

    Ok(FeeParams {
        mode,
        gas_limit,
        base_fee_per_gas,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas_price,
        el,
        rp,
    })
}

// The single-letter field names (`h`, `n`, `t`, `v`, `p`, `r`, `w`) match
// the Tron block-header wire format, so we preserve them verbatim.
#[allow(clippy::many_single_char_names)]
fn optional_block_header(raw: Option<&Value>) -> Result<Option<TronBlockHeader>, TxCompilerError> {
    let Some(value) = raw else { return Ok(None) };
    if value.is_null() {
        return Ok(None);
    }

    let obj = value.as_object().ok_or_else(|| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block header must be an object",
        )
    })?;

    let h = require_non_empty_string_with(obj, "h", || {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block header is missing required field 'h' (block hash)",
        )
    })?;

    let n = require_positive_int(obj, "n")?;
    let t = require_positive_int(obj, "t")?;
    let v = require_non_neg_int(obj, "v")?;

    // Tron block IDs are always exactly 32 bytes (64 hex chars).
    // Rejecting anything else here prevents crafted payloads from
    // driving `hex::decode` to allocate arbitrary amounts downstream.
    if h.len() != 64 {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block ID (h) must be exactly 64 hex characters (32 bytes)",
        ));
    }
    if !is_hex(&h) {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            "Block ID (h) must contain only hex characters",
        ));
    }

    // `p` (parent hash), `r` (tx trie root), `w` (witness address) are
    // informational fields — not used in compilation, but stored on
    // `PreparedTransaction` and surfaced in `review()`. Cap them at a
    // conservative 128 chars (see `MAX_INFO_FIELD_LEN`) so a crafted
    // payload cannot silently park a megabyte of data in process memory.
    let p = optional_bounded_string(obj, "p", MAX_INFO_FIELD_LEN)?;
    let r = optional_bounded_string(obj, "r", MAX_INFO_FIELD_LEN)?;
    let w = optional_bounded_string(obj, "w", MAX_INFO_FIELD_LEN)?;

    Ok(Some(TronBlockHeader {
        h,
        n,
        t,
        p,
        r,
        w,
        v,
    }))
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

fn require_non_empty_string(
    obj: &Map<String, Value>,
    field: &str,
) -> Result<String, TxCompilerError> {
    let value = require_non_empty_string_with(obj, field, || {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            format!("Missing or empty string field: {field}"),
        )
    })?;
    if value.trim().is_empty() {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidPayload,
            format!("Field '{field}' must not be blank or whitespace-only"),
        ));
    }
    Ok(value)
}

fn require_non_empty_string_with<F>(
    obj: &Map<String, Value>,
    field: &str,
    err: F,
) -> Result<String, TxCompilerError>
where
    F: FnOnce() -> TxCompilerError,
{
    match obj.get(field).and_then(Value::as_str) {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => Err(err()),
    }
}

fn optional_string(obj: &Map<String, Value>, field: &str) -> Option<String> {
    match obj.get(field) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn optional_number(obj: &Map<String, Value>, field: &str) -> Option<i64> {
    let v = obj.get(field)?;
    if v.is_null() {
        return None;
    }
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    if let Some(u) = v.as_u64() {
        return i64::try_from(u).ok();
    }
    // Not an integer JSON number (float or out of i64 range).
    None
}

fn require_int_string(obj: &Map<String, Value>, field: &str) -> Result<String, TxCompilerError> {
    let raw = obj.get(field);
    let s = raw.and_then(coerce_to_string).filter(|s| is_non_neg_int(s));
    s.ok_or_else(|| {
        TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidAmount,
            format!("{field} must be a non-negative integer"),
            serde_json::json!({ "field": field, "value": raw }),
        )
    })
}

fn optional_int_string(
    obj: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, TxCompilerError> {
    let Some(raw) = obj.get(field) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    coerce_to_string(raw)
        .filter(|s| is_non_neg_int(s))
        .map_or_else(
            || {
                Err(TxCompilerError::with_details(
                    TxCompilerErrorCode::InvalidAmount,
                    format!("{field} must be a non-negative integer"),
                    serde_json::json!({ "field": field, "value": raw }),
                ))
            },
            |s| Ok(Some(s)),
        )
}

fn coerce_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                return Some(u.to_string());
            }
            // Reject negative integers and any float representation.
            // Floats lose precision above 2^53 and would silently
            // corrupt large wei / SUN amounts. Integers arrive as
            // exact u64 via `as_u64`; anything else is not an
            // acceptable non-negative integer.
            None
        }
        _ => None,
    }
}

fn require_positive_int(obj: &Map<String, Value>, field: &str) -> Result<u64, TxCompilerError> {
    let invalid = || {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            format!("{field} must be a positive integer"),
        )
    };
    let v = obj.get(field).ok_or_else(invalid)?;
    // Only accept exact u64 values. Any positive i64 that fits in u64
    // is already reachable via `as_u64`, so the `as_i64` branch was
    // dead; rejecting anything else (floats, negatives) here closes
    // the silent-precision-loss path.
    v.as_u64().filter(|u| *u > 0).ok_or_else(invalid)
}

fn require_non_neg_int(obj: &Map<String, Value>, field: &str) -> Result<u32, TxCompilerError> {
    let invalid = || {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidBlockHeader,
            format!("{field} must be a non-negative integer"),
        )
    };
    let v = obj.get(field).ok_or_else(invalid)?;
    // Accept only exact non-negative integers; the `as_i64` branch is
    // unreachable because any `i64 >= 0` is representable via `as_u64`.
    v.as_u64().map_or_else(
        || Err(invalid()),
        |u| u32::try_from(u).map_err(|_| invalid()),
    )
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn optional_bounded_string(
    obj: &Map<String, Value>,
    field: &str,
    max_len: usize,
) -> Result<Option<String>, TxCompilerError> {
    let Some(value) = obj.get(field).and_then(Value::as_str) else {
        return Ok(None);
    };
    if value.len() > max_len {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidBlockHeader,
            format!("Block header field '{field}' exceeds {max_len}-char limit"),
            serde_json::json!({ "field": field, "len": value.len(), "limit": max_len }),
        ));
    }
    Ok(Some(value.to_string()))
}

/// Upper bound on decimal-encoded unsigned integers accepted by the
/// validator. 78 digits is the width of `U256::MAX`
/// (115 792 089 237 316 195 423 570 985 008 687 907 853 269 984 665
/// 640 564 039 457 584 007 913 129 639 935). Any numeric payload field
/// longer than this cannot fit in a U256 and is always invalid; the cap
/// prevents a caller from forcing linear-cost parses on crafted
/// megabyte-sized strings.
const MAX_DECIMAL_LEN: usize = 78;

fn is_non_neg_int(s: &str) -> bool {
    if s.is_empty() || s.len() > MAX_DECIMAL_LEN {
        return false;
    }
    if s == "0" {
        return true;
    }
    let mut bytes = s.bytes();
    match bytes.next() {
        Some(b'1'..=b'9') => {}
        _ => return false,
    }
    bytes.all(|b| b.is_ascii_digit())
}

fn invalid_payload(msg: &str) -> TxCompilerError {
    TxCompilerError::new(TxCompilerErrorCode::InvalidPayload, msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_evm() -> Value {
        serde_json::json!({
            "chain": "ethereum",
            "chainId": 1,
            "from": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
            "to": "0x0000000000000000000000000000000000000001",
            "valueWei": "1000000000000000000",
            "data": null,
            "txType": "TRANSFER_NATIVE",
            "tokenContract": null,
            "nonce": "1649",
            "fee": {
                "mode": "EIP1559",
                "gasLimit": "24338",
                "maxPriorityFeePerGas": "1000000000",
                "maxFeePerGas": "1214529816"
            }
        })
    }

    #[test]
    fn accepts_minimal_evm_payload() {
        let prepared = validate(&base_evm()).unwrap();
        assert_eq!(prepared.chain, Chain::Ethereum);
        assert_eq!(prepared.tx_type, TxType::TransferNative);
    }

    #[test]
    fn rejects_null_input() {
        let err = validate(&Value::Null).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_unknown_chain() {
        let mut v = base_evm();
        v["chain"] = Value::from("solana");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::UnsupportedChain);
    }

    #[test]
    fn rejects_negative_chain_id() {
        let mut v = base_evm();
        v["chainId"] = Value::from(-1);
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_missing_nonce_for_evm() {
        let mut v = base_evm();
        v["nonce"] = Value::Null;
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_oversized_nonce() {
        let mut v = base_evm();
        v["nonce"] = Value::String("9007199254740992".into()); // 2^53
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_invalid_evm_address() {
        let mut v = base_evm();
        v["from"] = Value::String("0xZZ".into());
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAddress);
    }

    #[test]
    fn rejects_native_with_calldata() {
        let mut v = base_evm();
        v["data"] = Value::String("0xdeadbeef".into());
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_tron_mode_for_evm() {
        let mut v = base_evm();
        v["fee"]["mode"] = Value::from("TRON");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::UnsupportedFeeMode);
    }

    #[test]
    fn rejects_eip1559_without_max_fee() {
        let mut v = base_evm();
        v["fee"].as_object_mut().unwrap().remove("maxFeePerGas");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::MissingFeeParams);
    }

    #[test]
    fn accepts_legacy_with_gas_price() {
        let mut v = base_evm();
        v["fee"] = serde_json::json!({
            "mode": "LEGACY",
            "gasLimit": "21000",
            "gasPrice": "5000000000"
        });
        let prepared = validate(&v).unwrap();
        assert_eq!(prepared.fee.mode, FeeMode::Legacy);
    }

    #[test]
    fn rejects_token_without_contract() {
        let mut v = base_evm();
        v["txType"] = Value::from("TRANSFER_TOKEN");
        v["valueWei"] = Value::from("0");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_token_calldata_wrong_selector() {
        let mut v = base_evm();
        v["txType"] = Value::from("TRANSFER_TOKEN");
        v["valueWei"] = Value::from("0");
        v["tokenContract"] = Value::from("0x0000000000000000000000000000000000000001");
        v["to"] = Value::from("0x0000000000000000000000000000000000000001");
        v["data"] = Value::from(format!("0x{}", "ab".repeat(68)));
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidCalldata);
    }

    #[test]
    fn accepts_tron_native_payload() {
        let payload = serde_json::json!({
            "chain": "tron",
            "chainId": null,
            "from": "41d8da6bf26964af9d7eed9e03e53415d37aa96045",
            "to": "410000000000000000000000000000000000000001",
            "valueWei": "5000000",
            "data": null,
            "txType": "TRANSFER_NATIVE",
            "tokenContract": null,
            "nonce": null,
            "fee": {
                "mode": "TRON",
                "rp": {
                    "h": "0000000003b8e4b2a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
                    "n": 62_522_546,
                    "t": 1_710_000_000_000_u64,
                    "v": 30
                }
            }
        });
        let prepared = validate(&payload).unwrap();
        assert_eq!(prepared.chain, Chain::Tron);
    }

    #[test]
    fn coerces_numeric_nonce() {
        let mut v = base_evm();
        v["nonce"] = Value::from(42);
        let prepared = validate(&v).unwrap();
        assert_eq!(prepared.nonce.as_deref(), Some("42"));
    }

    #[test]
    fn rejects_fractional_value_wei() {
        let mut v = base_evm();
        v["valueWei"] = serde_json::json!(1.5);
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAmount);
    }

    #[test]
    fn rejects_value_wei_as_large_float() {
        // A JSON number of `1e18` arrives as f64; rejecting prevents
        // silent precision loss for values that round under 2^53.
        let mut v = base_evm();
        v["valueWei"] = serde_json::json!(1e18);
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAmount);
    }

    #[test]
    fn rejects_value_wei_exceeding_u256_width() {
        // 79-digit decimal: one character past U256::MAX width.
        let mut v = base_evm();
        v["valueWei"] = Value::from("1".to_string() + &"0".repeat(78));
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAmount);
    }

    #[test]
    fn rejects_whitespace_only_from_address() {
        let mut v = base_evm();
        v["from"] = Value::from("   ");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidPayload);
    }

    #[test]
    fn rejects_tron_block_id_not_exactly_64_chars() {
        let mut v = serde_json::json!({
            "chain": "tron",
            "chainId": null,
            "from": "41d8da6bf26964af9d7eed9e03e53415d37aa96045",
            "to": "410000000000000000000000000000000000000001",
            "valueWei": "5000000",
            "data": null,
            "txType": "TRANSFER_NATIVE",
            "tokenContract": null,
            "nonce": null,
            "fee": {
                "mode": "TRON",
                "rp": {
                    // 63 hex chars (one short)
                    "h": "0000000003b8e4b2a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f",
                    "n": 62_522_546,
                    "t": 1_710_000_000_000_u64,
                    "v": 30
                }
            }
        });
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidBlockHeader);

        // 66 hex chars (two too many)
        v["fee"]["rp"]["h"] =
            Value::from("0000000003b8e4b2a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4aa");
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidBlockHeader);
    }

    #[test]
    fn rejects_erc20_calldata_with_non_zero_pad() {
        // Valid selector + non-zero bytes in the left pad of the address
        // word must be rejected — an attacker could hide a 32-byte "high"
        // address value in the pad that a naive consumer might trust.
        let mut v = base_evm();
        v["txType"] = Value::from("TRANSFER_TOKEN");
        v["tokenContract"] = Value::from("0x0000000000000000000000000000000000000001");
        v["to"] = Value::from("0x0000000000000000000000000000000000000001");
        v["valueWei"] = Value::from("0");
        // selector + junk in high bytes of address word + valid address + amount
        let mut data = String::from("0xa9059cbb");
        data.push_str(&"ff".repeat(12)); // left pad: should be zero, is 0xff
        data.push_str(&"00".repeat(20)); // the actual 20-byte address
        data.push_str(&"00".repeat(32)); // amount
        v["data"] = Value::from(data);
        let err = validate(&v).unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidCalldata);
    }
}
