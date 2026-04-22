//! Error codes and the [`TxCompilerError`] type.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Discriminator for the class of error raised by the compiler.
///
/// The variants use stable string discriminators so downstream consumers
/// can share audit receipts and error vocabulary across versions.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum TxCompilerErrorCode {
    /// The caller passed an input that failed top-level shape checks.
    InvalidPayload,
    /// The chain identifier is not one this crate compiles.
    UnsupportedChain,
    /// The transaction type is not recognised.
    UnsupportedTxType,
    /// The fee mode is not valid for the target chain.
    UnsupportedFeeMode,
    /// An address failed chain-specific validation.
    InvalidAddress,
    /// A numeric amount (wei, SUN, gas unit) was malformed.
    InvalidAmount,
    /// A mode-required fee parameter was absent.
    MissingFeeParams,
    /// The Tron block-header reference is malformed or incomplete.
    InvalidBlockHeader,
    /// An EVM ERC-20 calldata payload was malformed.
    InvalidCalldata,
    /// A downstream compilation step failed unexpectedly.
    CompilationFailed,
}

impl TxCompilerErrorCode {
    /// Stable string representation used in audit records and error JSON.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidPayload => "INVALID_PAYLOAD",
            Self::UnsupportedChain => "UNSUPPORTED_CHAIN",
            Self::UnsupportedTxType => "UNSUPPORTED_TX_TYPE",
            Self::UnsupportedFeeMode => "UNSUPPORTED_FEE_MODE",
            Self::InvalidAddress => "INVALID_ADDRESS",
            Self::InvalidAmount => "INVALID_AMOUNT",
            Self::MissingFeeParams => "MISSING_FEE_PARAMS",
            Self::InvalidBlockHeader => "INVALID_BLOCK_HEADER",
            Self::InvalidCalldata => "INVALID_CALLDATA",
            Self::CompilationFailed => "COMPILATION_FAILED",
        }
    }
}

impl fmt::Display for TxCompilerErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Structured error returned by every public operation.
///
/// The error carries a machine-readable [`TxCompilerErrorCode`], a
/// human-readable message, and an optional JSON object with debug context.
///
/// Only [`TxCompilerError::code`] is part of the stable API: downstream
/// code should match on `code` for branching logic. The `message` text
/// is human-readable and MAY change between versions for clarity.
/// `details` is an unstable debug payload — do not pattern-match on
/// its keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[non_exhaustive]
pub struct TxCompilerError {
    /// Machine-readable error discriminator.
    pub code: TxCompilerErrorCode,
    /// Human-readable description of the failure. Not part of the
    /// stable API — do not pattern-match on contents.
    pub message: String,
    /// Optional structured context useful for debugging. Unstable;
    /// do not pattern-match on keys.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl TxCompilerError {
    /// Build an error without a `details` payload.
    #[must_use]
    pub fn new(code: TxCompilerErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    /// Build an error with a structured `details` payload.
    #[must_use]
    pub fn with_details(
        code: TxCompilerErrorCode,
        message: impl Into<String>,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details: Some(details),
        }
    }
}

impl fmt::Display for TxCompilerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for TxCompilerError {}
