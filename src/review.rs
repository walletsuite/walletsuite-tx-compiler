//! Derive a human-reviewable summary from a prepared transaction.

use alloy_primitives::U256;

use crate::constants::{ERC20_TRANSFER_CALLDATA_HEX_LEN, ERC20_TRANSFER_SELECTOR_HEX};
use crate::error::{TxCompilerError, TxCompilerErrorCode};
use crate::types::{
    Chain, FeeMode, FeeParams, FeeReview, PreparedTransaction, TransactionReview, TxType,
};

/// Produce a human-reviewable summary of `prepared`.
///
/// For EVM token transfers the actual recipient and amount are decoded from
/// the calldata, so the review reflects what will execute on-chain rather
/// than the raw envelope fields.
pub fn review(prepared: &PreparedTransaction) -> Result<TransactionReview, TxCompilerError> {
    let (recipient, amount) = match (prepared.tx_type, prepared.chain) {
        (TxType::TransferNative, _) | (TxType::TransferToken, Chain::Tron) => {
            (prepared.to.clone(), prepared.value_wei.clone())
        }
        (TxType::TransferToken, Chain::Ethereum) => {
            let data = prepared.data.as_deref().ok_or_else(|| {
                TxCompilerError::new(
                    TxCompilerErrorCode::InvalidCalldata,
                    "EVM token transfer missing calldata (data)",
                )
            })?;
            decode_erc20_transfer_data(data)?
        }
    };

    Ok(TransactionReview {
        chain: prepared.chain,
        tx_type: prepared.tx_type,
        from: prepared.from.clone(),
        recipient,
        amount,
        token_contract: prepared.token_contract.clone(),
        nonce: prepared.nonce.clone(),
        chain_id: prepared.chain_id,
        fee: build_fee_review(&prepared.fee),
    })
}

fn decode_erc20_transfer_data(data: &str) -> Result<(String, String), TxCompilerError> {
    let hex_str = data.strip_prefix("0x").unwrap_or(data);

    if !is_hex(hex_str) {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            "ERC-20 transfer calldata contains non-hex characters",
        ));
    }

    if hex_str.len() != ERC20_TRANSFER_CALLDATA_HEX_LEN {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidCalldata,
            format!(
                "ERC-20 transfer calldata must be exactly 68 bytes (got {})",
                hex_str.len() / 2
            ),
            serde_json::json!({
                "length": hex_str.len(),
                "expected": ERC20_TRANSFER_CALLDATA_HEX_LEN,
            }),
        ));
    }

    let selector = hex_str[0..8].to_ascii_lowercase();
    if selector != ERC20_TRANSFER_SELECTOR_HEX {
        return Err(TxCompilerError::with_details(
            TxCompilerErrorCode::InvalidCalldata,
            "Calldata does not start with the ERC-20 transfer selector",
            serde_json::json!({
                "expected": ERC20_TRANSFER_SELECTOR_HEX,
                "actual": selector,
            }),
        ));
    }

    // Enforce the 24-char left zero-pad even on this code path. `validate`
    // already does this, but `review` may be called on a
    // `PreparedTransaction` constructed by any other path (direct serde
    // deserialise from a hostile source, for instance). Without this guard
    // a crafted calldata would silently truncate the high bytes of the
    // address word and display a different recipient than what the signer
    // will actually sign for.
    let address_word = &hex_str[8..72];
    if !address_word[..24].bytes().all(|b| b == b'0') {
        return Err(TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            "ERC-20 transfer recipient word must be left-zero-padded",
        ));
    }
    let recipient_hex = &address_word[24..];
    let recipient = format!("0x{recipient_hex}");

    let amount_hex = &hex_str[72..136];
    let amount_u256 = U256::from_str_radix(amount_hex, 16).map_err(|_| {
        TxCompilerError::new(
            TxCompilerErrorCode::InvalidCalldata,
            "ERC-20 transfer amount is not valid hex",
        )
    })?;

    Ok((recipient, amount_u256.to_string()))
}

fn build_fee_review(fee: &FeeParams) -> FeeReview {
    match fee.mode {
        FeeMode::Eip1559 => {
            let gas_limit = fee.gas_limit.clone().unwrap_or_else(|| "0".into());
            let max_fee = fee.max_fee_per_gas.clone().unwrap_or_else(|| "0".into());
            let estimated = multiply_decimal(&gas_limit, &max_fee);
            FeeReview {
                mode: FeeMode::Eip1559,
                estimated_max_cost: Some(estimated),
                gas_limit: Some(gas_limit),
                gas_price: None,
                max_fee_per_gas: Some(max_fee),
                max_priority_fee_per_gas: fee.max_priority_fee_per_gas.clone(),
                base_fee_per_gas: fee.base_fee_per_gas.clone(),
                tron_fee_limit: None,
            }
        }
        FeeMode::Legacy => {
            let gas_limit = fee.gas_limit.clone().unwrap_or_else(|| "0".into());
            let gas_price = fee
                .gas_price
                .clone()
                .or_else(|| fee.max_fee_per_gas.clone())
                .unwrap_or_else(|| "0".into());
            let estimated = multiply_decimal(&gas_limit, &gas_price);
            FeeReview {
                mode: FeeMode::Legacy,
                estimated_max_cost: Some(estimated),
                gas_limit: Some(gas_limit),
                gas_price: Some(gas_price),
                max_fee_per_gas: None,
                max_priority_fee_per_gas: None,
                base_fee_per_gas: None,
                tron_fee_limit: None,
            }
        }
        FeeMode::Tron => FeeReview {
            mode: FeeMode::Tron,
            estimated_max_cost: fee.el.clone(),
            gas_limit: None,
            gas_price: None,
            max_fee_per_gas: None,
            max_priority_fee_per_gas: None,
            base_fee_per_gas: None,
            tron_fee_limit: fee.el.clone(),
        },
    }
}

fn multiply_decimal(a: &str, b: &str) -> String {
    // U256 × U256; sufficient for any realistic gas × gas-price product.
    let Ok(lhs) = U256::from_str_radix(a, 10) else {
        return "0".into();
    };
    let Ok(rhs) = U256::from_str_radix(b, 10) else {
        return "0".into();
    };
    lhs.saturating_mul(rhs).to_string()
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}
