//! Tron address decoding and shape validation.
//!
//! Accepts either the 41-prefixed hex form (`41…`, optionally `0x` prefixed)
//! or the `T…` base58check encoding used by public tooling. Returns the
//! 21-byte raw address (leading `0x41` byte + 20-byte public-key hash).
//!
//! Every return path is guaranteed to produce exactly 21 bytes with a
//! leading `0x41` — callers that slice `&bytes[1..21]` depend on this
//! invariant.

use crate::error::{TxCompilerError, TxCompilerErrorCode};

/// Expected byte length of a decoded Tron address: `0x41` prefix +
/// 20-byte public-key hash.
const TRON_ADDRESS_LEN: usize = 21;

/// Tron address prefix byte.
const TRON_ADDRESS_PREFIX: u8 = 0x41;

/// Decode a Tron address into its raw 21-byte representation.
///
/// On success the returned `Vec<u8>` is always exactly 21 bytes long
/// (the `0x41` prefix byte plus the 20-byte public-key hash). Malformed
/// inputs (wrong prefix, wrong length, invalid base58check, junk hex)
/// return an `InvalidAddress` error.
pub fn tron_address_to_bytes(address: &str) -> Result<Vec<u8>, TxCompilerError> {
    if let Some(stripped) = strip_hex_prefix(address) {
        let bytes = hex::decode(stripped).map_err(|_| invalid_address(address))?;
        enforce_shape(&bytes, address)?;
        return Ok(bytes);
    }

    // Tron base58check addresses are always exactly 34 characters; the
    // decoder would tolerate shorter input and then `enforce_shape` would
    // reject the result, but tightening here shrinks the attack surface
    // of `bs58::decode`.
    if address.starts_with('T') && address.len() == 34 {
        let bytes = bs58::decode(address)
            .with_check(None)
            .into_vec()
            .map_err(|_| invalid_address(address))?;
        enforce_shape(&bytes, address)?;
        return Ok(bytes);
    }

    Err(invalid_address(address))
}

/// Enforce that a decoded byte sequence has the canonical 21-byte
/// Tron address shape with a `0x41` prefix. Defence-in-depth against
/// upstream parser changes (e.g. a different hex-prefix strategy in
/// [`strip_hex_prefix`] that ever admits a non-`41` leading byte).
fn enforce_shape(bytes: &[u8], address: &str) -> Result<(), TxCompilerError> {
    if bytes.len() != TRON_ADDRESS_LEN || bytes[0] != TRON_ADDRESS_PREFIX {
        return Err(invalid_address(address));
    }
    Ok(())
}

/// Return the hex payload if `address` matches `^(0x)?41[0-9a-fA-F]{40}$`.
fn strip_hex_prefix(address: &str) -> Option<&str> {
    let unprefixed = address.strip_prefix("0x").unwrap_or(address);
    if unprefixed.len() != 42 {
        return None;
    }
    let bytes = unprefixed.as_bytes();
    if bytes[0] != b'4' || bytes[1] != b'1' {
        return None;
    }
    if unprefixed[2..].bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(unprefixed)
    } else {
        None
    }
}

fn invalid_address(address: &str) -> TxCompilerError {
    // Keep the raw address out of the human-readable message — it lives
    // in `details` only, where callers can choose whether to redact.
    TxCompilerError::with_details(
        TxCompilerErrorCode::InvalidAddress,
        "Invalid Tron address format",
        serde_json::json!({ "address": address }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_hex_form() {
        let bytes = tron_address_to_bytes("41d8da6bf26964af9d7eed9e03e53415d37aa96045").unwrap();
        assert_eq!(bytes.len(), 21);
        assert_eq!(bytes[0], 0x41);
    }

    #[test]
    fn decodes_hex_form_with_0x_prefix() {
        let bytes = tron_address_to_bytes("0x41d8da6bf26964af9d7eed9e03e53415d37aa96045").unwrap();
        assert_eq!(bytes.len(), 21);
        assert_eq!(bytes[0], 0x41);
    }

    #[test]
    fn decodes_t_prefix_base58check() {
        // Known-valid Tron address.
        let bytes = tron_address_to_bytes("TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy").unwrap();
        assert_eq!(bytes.len(), 21);
        assert_eq!(bytes[0], 0x41);
    }

    #[test]
    fn rejects_short_hex() {
        let err = tron_address_to_bytes("41ab").unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAddress);
    }

    #[test]
    fn returned_bytes_always_start_with_0x41() {
        // Defence-in-depth: verify the 0x41 prefix is enforced on every
        // successful return path so the `[1..21]` slice in
        // `build_trc20_transfer_data` never reads an unexpected byte.
        for input in [
            "41d8da6bf26964af9d7eed9e03e53415d37aa96045",
            "0x41d8da6bf26964af9d7eed9e03e53415d37aa96045",
            "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy",
        ] {
            let bytes = tron_address_to_bytes(input).unwrap_or_else(|e| {
                panic!("expected {input} to decode: {e}");
            });
            assert_eq!(bytes.len(), 21, "{input}: wrong byte length");
            assert_eq!(bytes[0], 0x41, "{input}: missing 0x41 prefix");
        }
    }

    #[test]
    fn rejects_non_tron_prefix_hex() {
        let err = tron_address_to_bytes("d8da6bf26964af9d7eed9e03e53415d37aa96045").unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAddress);
    }

    #[test]
    fn rejects_invalid_base58_checksum() {
        let err = tron_address_to_bytes("TLsV52sRDL79HXGGm9yzwKibb6BeruhUzz").unwrap_err();
        assert_eq!(err.code, TxCompilerErrorCode::InvalidAddress);
    }
}
