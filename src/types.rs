//! Input and output types for the transaction compiler.
//!
//! The serde layout is the canonical JSON shape of a `WalletSuite`
//! `PrepareSignResponseDto` so downstream consumers share on-the-wire
//! vocabulary.
//!
//! All public structs and enums are marked `#[non_exhaustive]` so that
//! future additions (new chains, new tx types, new fee fields) do not
//! force a major version bump. Downstream code must construct these
//! types via serde (`serde_json::from_value`) rather than struct
//! literals, and must use `_ => ...` when matching on enums.

use serde::{Deserialize, Serialize};

/// Supported chain families.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum Chain {
    /// Ethereum and EVM-compatible chains (BSC, Polygon, Arbitrum, …).
    Ethereum,
    /// The Tron mainnet or testnets.
    Tron,
}

/// Fee calculation mode carried by a prepared transaction.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum FeeMode {
    /// Dynamic fee market transactions (EIP-1559, type 2 envelope).
    #[serde(rename = "EIP1559")]
    Eip1559,
    /// Legacy gas-price transactions (type 0 envelope, EIP-155 signed).
    #[serde(rename = "LEGACY")]
    Legacy,
    /// Tron fee structure with fee limit and block reference.
    #[serde(rename = "TRON")]
    Tron,
}

impl FeeMode {
    /// The stable string discriminator used on the wire and in error
    /// messages (`"EIP1559"`, `"LEGACY"`, `"TRON"`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Eip1559 => "EIP1559",
            Self::Legacy => "LEGACY",
            Self::Tron => "TRON",
        }
    }
}

/// Intent expressed by the prepared payload.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum TxType {
    /// Native token transfer (ETH, BNB, TRX, …).
    #[serde(rename = "TRANSFER_NATIVE")]
    TransferNative,
    /// Fungible token transfer (ERC-20 on EVM, TRC-20 on Tron).
    #[serde(rename = "TRANSFER_TOKEN")]
    TransferToken,
}

/// Tron block-header reference used for replay protection and
/// `Transaction.raw_data` construction.
///
/// Field names match the Tron block-header JSON wire format verbatim so
/// payloads round-trip without remapping. See the Tron protocol
/// documentation for the authoritative schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[non_exhaustive]
pub struct TronBlockHeader {
    /// `h` — block hash (hex string, no `0x` prefix). Used to derive the
    /// `refBlockHash` field of `Transaction.raw_data`.
    pub h: String,
    /// `n` — block number. The low 16 bits become `refBlockBytes` in
    /// `Transaction.raw_data`.
    pub n: u64,
    /// `t` — block timestamp in milliseconds since the Unix epoch.
    pub t: u64,
    /// `p` — parent block hash (informational, not used in compilation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<String>,
    /// `r` — transaction trie root (informational).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r: Option<String>,
    /// `w` — witness (block producer) address (informational).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<String>,
    /// `v` — protocol version.
    pub v: u32,
}

/// Mode-discriminated fee parameters. Exactly one of the three
/// mode-specific subsets is populated; the others are `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FeeParams {
    /// Active fee mode (discriminator for the rest of this struct).
    pub mode: FeeMode,
    /// Gas unit limit (EVM only, both EIP-1559 and LEGACY).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas_limit: Option<String>,
    /// Base fee per gas in wei (EIP-1559 only, informational).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_fee_per_gas: Option<String>,
    /// Priority fee (tip) per gas in wei (EIP-1559 only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_priority_fee_per_gas: Option<String>,
    /// Maximum fee per gas in wei (EIP-1559 only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_fee_per_gas: Option<String>,
    /// Gas price in wei (LEGACY only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas_price: Option<String>,
    /// `el` — Tron energy fee limit in SUN (Tron only, optional).
    /// Field name mirrors the wire-format short key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub el: Option<String>,
    /// `rp` — Tron reference-point block header used for replay
    /// protection and `Transaction.raw_data` construction. Required on
    /// the Tron path; field name mirrors the wire-format short key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rp: Option<TronBlockHeader>,
}

/// Canonical prepared transaction payload from the `WalletSuite`
/// prepare-sign API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PreparedTransaction {
    /// Target chain family.
    pub chain: Chain,
    /// Chain ID (EVM only, `None` for Tron).
    pub chain_id: Option<i64>,
    /// Sender address.
    pub from: String,
    /// On-envelope recipient address.
    ///
    /// For EVM token transfers this equals `token_contract`; the real recipient
    /// lives inside `data`.
    pub to: String,
    /// Amount in smallest units (wei / SUN) as a decimal string.
    pub value_wei: String,
    /// ABI-encoded calldata (EVM token transfers); `None` otherwise.
    pub data: Option<String>,
    /// Intent.
    pub tx_type: TxType,
    /// Token contract address (token transfers only).
    pub token_contract: Option<String>,
    /// Transaction nonce as a decimal string (EVM only).
    pub nonce: Option<String>,
    /// Fee parameters.
    pub fee: FeeParams,
}

/// Result of compiling a prepared transaction.
///
/// - For EVM: `unsigned_tx` is the EIP-2718 signing pre-image
///   (`0x02 || rlp([...])` for EIP-1559, `rlp([..., chainId, 0, 0])` for
///   legacy EIP-155). To broadcast after signing, the caller must
///   reconstruct the signed envelope by replacing the zero signature
///   fields — use `alloy_consensus::TxEnvelope` or an equivalent
///   library. `tx_hash` is `keccak256(unsigned_tx)`.
/// - For Tron: `unsigned_tx` is the protobuf-encoded
///   `Transaction.raw_data` bytes. The caller wraps `raw_data` and the
///   signature into the outer `Transaction` message to broadcast.
///   `tx_hash` is `sha256(unsigned_tx)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CompilationResult {
    /// Chain the transaction was compiled for.
    pub chain: Chain,
    /// Hex-encoded signing pre-image / raw-data bytes (`0x`-prefixed).
    /// See the struct-level docs for per-chain semantics.
    pub unsigned_tx: String,
    /// Hash the caller signs (`0x`-prefixed). keccak256 for EVM,
    /// SHA-256 for Tron.
    pub tx_hash: String,
    /// Metadata about the compilation choices.
    pub metadata: CompilationMetadata,
}

/// Metadata describing how a transaction was compiled.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CompilationMetadata {
    /// Intent of the compiled transaction.
    pub tx_type: TxType,
    /// Fee mode used for compilation.
    pub fee_mode: FeeMode,
    /// EVM envelope type: `0` for legacy, `2` for EIP-1559.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evm_tx_type: Option<u8>,
    /// Tron contract type: `1` for `TransferContract`, `31` for
    /// `TriggerSmartContract`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tron_contract_type: Option<u8>,
    /// Tron transaction expiration timestamp in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration: Option<u64>,
}

/// Human-reviewable representation of a transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TransactionReview {
    /// Target chain family.
    pub chain: Chain,
    /// Intent.
    pub tx_type: TxType,
    /// Sender address.
    pub from: String,
    /// Decoded recipient (from calldata for EVM token transfers).
    pub recipient: String,
    /// Transfer amount in smallest units (decimal string).
    pub amount: String,
    /// Token contract (token transfers only).
    pub token_contract: Option<String>,
    /// Transaction nonce (EVM only).
    pub nonce: Option<String>,
    /// Chain ID (EVM only).
    pub chain_id: Option<i64>,
    /// Fee summary.
    pub fee: FeeReview,
}

/// Fee summary sized for display to a human reviewer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct FeeReview {
    /// Active fee mode.
    pub mode: FeeMode,
    /// Estimated maximum fee cost in smallest native units.
    ///
    /// `None` encodes JSON `null` when the estimate is unavailable (Tron
    /// without a fee limit).
    pub estimated_max_cost: Option<String>,
    /// Gas unit limit (EVM only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas_limit: Option<String>,
    /// Gas price in wei (LEGACY only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas_price: Option<String>,
    /// Maximum fee per gas in wei (EIP-1559 only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_fee_per_gas: Option<String>,
    /// Priority fee per gas in wei (EIP-1559 only, when set).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_priority_fee_per_gas: Option<String>,
    /// Base fee per gas in wei (EIP-1559 only, when set).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_fee_per_gas: Option<String>,
    /// Tron fee limit in SUN (Tron only, when set).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tron_fee_limit: Option<String>,
}

/// Options for [`crate::compile`].
#[derive(Debug, Clone, Copy, Default)]
#[non_exhaustive]
pub struct CompileOptions {
    /// Override wall-clock time (milliseconds since epoch) for Tron
    /// transactions.
    ///
    /// **Callers that require byte-exact reproducibility MUST supply a
    /// value here.** When `None`, Tron `timestamp` and `expiration` fall
    /// back to `SystemTime::now()` and the compiled `unsigned_tx` /
    /// `tx_hash` outputs will vary across calls. EVM compilation is
    /// unaffected — this field is read only on the Tron path.
    pub now: Option<u64>,
}

impl CompileOptions {
    /// Construct a new `CompileOptions` with default values. Preferred
    /// over struct-literal construction so future fields can be added
    /// without breaking callers.
    #[must_use]
    pub const fn new() -> Self {
        Self { now: None }
    }

    /// Set the wall-clock override for Tron compilation. See the `now`
    /// field documentation for reproducibility implications.
    #[must_use]
    pub const fn with_now(mut self, now_ms: u64) -> Self {
        self.now = Some(now_ms);
        self
    }
}
