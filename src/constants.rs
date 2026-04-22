//! Shared on-chain constants used across validation, review, and compilation.
//!
//! These are exposed as a public module so downstream consumers (signers,
//! broadcasters, integration-test fixtures) can reference the same
//! constants by name instead of re-hardcoding the literals.

/// ABI selector for `transfer(address,uint256)`.
///
/// This is `keccak256("transfer(address,uint256)")[..4]` and is the same
/// selector for both ERC-20 (EVM) and TRC-20 (Tron smart-contract tokens).
pub const ERC20_TRANSFER_SELECTOR_BYTES: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];

/// Hex form of [`ERC20_TRANSFER_SELECTOR_BYTES`] without `0x` prefix.
pub const ERC20_TRANSFER_SELECTOR_HEX: &str = "a9059cbb";

/// Length in hex characters of a fully-encoded ERC-20 / TRC-20
/// `transfer(address,uint256)` calldata: 4-byte selector + 32-byte
/// zero-padded address + 32-byte big-endian amount = 68 bytes = 136 chars.
pub const ERC20_TRANSFER_CALLDATA_HEX_LEN: usize = 136;

/// Tron protocol `Contract.type` value for `TransferContract` (native TRX transfer).
pub const TRON_CONTRACT_TYPE_TRANSFER: u8 = 1;

/// Tron protocol `Contract.type` value for `TriggerSmartContract` (TRC-20 / contract call).
pub const TRON_CONTRACT_TYPE_TRIGGER_SMART: u8 = 31;

/// EIP-2718 transaction type byte for EIP-1559 dynamic-fee transactions.
pub const EVM_TX_TYPE_EIP1559: u8 = 2;

/// EIP-2718 transaction type byte for legacy (EIP-155) transactions.
///
/// Legacy transactions are not prefixed with a type byte on the wire;
/// this constant is surfaced in [`crate::types::CompilationMetadata`]
/// for downstream reporting only.
pub const EVM_TX_TYPE_LEGACY: u8 = 0;
