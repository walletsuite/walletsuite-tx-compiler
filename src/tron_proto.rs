//! Minimal protobuf encoder for Tron `Transaction.raw_data`.
//!
//! Only the wire primitives and message shapes required for
//! `TransferContract` (type 1) and `TriggerSmartContract` (type 31) are
//! implemented to avoid pulling a full protobuf runtime.

/// Wire type 0 (varint).
const WIRE_VARINT: u64 = 0;
/// Wire type 2 (length-delimited).
const WIRE_LEN: u64 = 2;

/// Append the unsigned-varint encoding of `value` to `out`.
fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        // `value & 0x7f` always fits in a u8.
        #[allow(clippy::cast_possible_truncation)]
        out.push(((value & 0x7f) as u8) | 0x80);
        value >>= 7;
    }
    // Final byte is guaranteed `< 0x80`, so the cast cannot truncate.
    #[allow(clippy::cast_possible_truncation)]
    out.push(value as u8);
}

/// Encode a non-negative integer as a protobuf unsigned varint.
/// Used by the canonical test harness to round-trip individual
/// values; the hot encoding path goes through [`write_varint`]
/// directly.
#[cfg(test)]
fn encode_varint(value: u64) -> Vec<u8> {
    let mut out = Vec::with_capacity(10);
    write_varint(&mut out, value);
    out
}

/// Append a single varint field (`field_num`, wire type 0) to `out`.
fn write_varint_field(out: &mut Vec<u8>, field_num: u64, value: u64) {
    write_varint(out, (field_num << 3) | WIRE_VARINT);
    write_varint(out, value);
}

/// Append a length-delimited bytes field (`field_num`, wire type 2) to `out`.
fn write_bytes_field(out: &mut Vec<u8>, field_num: u64, data: &[u8]) {
    write_varint(out, (field_num << 3) | WIRE_LEN);
    // `usize -> u64` is infallible in practice — `Vec::len()` is bounded
    // by `isize::MAX` and fits in `u64` on every supported target.
    write_varint(
        out,
        u64::try_from(data.len()).expect("slice length fits u64"),
    );
    out.extend_from_slice(data);
}

/// Encode a `TransferContract` message (Tron contract type 1).
#[must_use]
pub fn encode_transfer_contract(owner: &[u8], to: &[u8], amount: u64) -> Vec<u8> {
    let mut inner = Vec::with_capacity(32 + owner.len() + to.len());
    write_bytes_field(&mut inner, 1, owner);
    write_bytes_field(&mut inner, 2, to);
    write_varint_field(&mut inner, 3, amount);
    wrap_in_contract(1, "protocol.TransferContract", &inner)
}

/// Encode a `TriggerSmartContract` message (Tron contract type 31).
#[must_use]
pub fn encode_trigger_smart_contract(
    owner: &[u8],
    contract_address: &[u8],
    data: &[u8],
) -> Vec<u8> {
    let mut inner = Vec::with_capacity(32 + owner.len() + contract_address.len() + data.len());
    write_bytes_field(&mut inner, 1, owner);
    write_bytes_field(&mut inner, 2, contract_address);
    write_bytes_field(&mut inner, 4, data);
    wrap_in_contract(31, "protocol.TriggerSmartContract", &inner)
}

fn wrap_in_contract(contract_type: u64, type_url: &str, value: &[u8]) -> Vec<u8> {
    let full_url = format!("type.googleapis.com/{type_url}");
    let mut any = Vec::with_capacity(16 + full_url.len() + value.len());
    write_bytes_field(&mut any, 1, full_url.as_bytes());
    write_bytes_field(&mut any, 2, value);

    let mut buf = Vec::with_capacity(8 + any.len());
    write_varint_field(&mut buf, 1, contract_type);
    write_bytes_field(&mut buf, 2, &any);
    buf
}

/// Parameters for [`encode_raw_data`]. Fixed-size byte arrays encode
/// the Tron-spec widths at the type level.
pub struct RawDataParams<'a> {
    /// Reference block number suffix (low 16 bits of block number, big-endian).
    pub ref_block_bytes: &'a [u8; 2],
    /// Reference block hash suffix (bytes `[8..16]` of the block ID).
    pub ref_block_hash: &'a [u8; 8],
    /// Transaction expiration in milliseconds.
    pub expiration: u64,
    /// Transaction timestamp in milliseconds.
    pub timestamp: u64,
    /// Pre-encoded `Contract` message bytes.
    pub contract: &'a [u8],
    /// Optional fee limit in SUN; omitted when `None` or zero.
    pub fee_limit: Option<u64>,
}

/// Encode `Transaction.raw_data` with the canonical Tron field ordering.
///
/// Fields are emitted in the order `refBlockBytes(1) · refBlockHash(4) ·
/// expiration(8) · contract(11) · timestamp(14) · feeLimit(18)`. The
/// `feeLimit` entry is dropped when absent or zero.
#[must_use]
pub fn encode_raw_data(params: &RawDataParams<'_>) -> Vec<u8> {
    let mut buf = Vec::with_capacity(96 + params.contract.len());
    write_bytes_field(&mut buf, 1, params.ref_block_bytes);
    write_bytes_field(&mut buf, 4, params.ref_block_hash);
    write_varint_field(&mut buf, 8, params.expiration);
    write_bytes_field(&mut buf, 11, params.contract);
    write_varint_field(&mut buf, 14, params.timestamp);
    if let Some(fee_limit) = params.fee_limit {
        if fee_limit > 0 {
            write_varint_field(&mut buf, 18, fee_limit);
        }
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_zero() {
        assert_eq!(encode_varint(0), vec![0]);
    }

    #[test]
    fn varint_small() {
        assert_eq!(encode_varint(1), vec![1]);
        assert_eq!(encode_varint(0x7f), vec![0x7f]);
    }

    #[test]
    fn varint_multibyte() {
        assert_eq!(encode_varint(300), vec![0xac, 0x02]);
    }

    #[test]
    fn varint_roundtrip_expiration() {
        // 1710036000000 = 0x18e2_48f0_4e00; chosen from the canonical fixture set.
        let bytes = encode_varint(1_710_036_000_000);
        assert_eq!(bytes, vec![0x80, 0xba, 0xda, 0xb0, 0xe2, 0x31]);
    }

    fn decode_varint(bytes: &[u8]) -> Option<(u64, usize)> {
        let mut value = 0_u64;
        let mut shift = 0_u32;
        for (i, byte) in bytes.iter().enumerate() {
            let chunk = u64::from(byte & 0x7f);
            value |= chunk.checked_shl(shift).filter(|_| shift < 64)?;
            if byte & 0x80 == 0 {
                return Some((value, i + 1));
            }
            shift = shift.checked_add(7)?;
        }
        None
    }

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn varint_roundtrip(value: u64) {
            let bytes = encode_varint(value);
            let decoded = decode_varint(&bytes).expect("decodes");
            prop_assert_eq!(decoded, (value, bytes.len()));
        }
    }
}
