//! Deterministic transaction compilation for Ethereum (EVM) and Tron.
//!
//! This crate converts `WalletSuite` canonical prepared transaction payloads
//! into signer-ready unsigned artifacts and human-reviewable representations.
//!
//! # Example
//!
//! ```
//! use walletsuite_tx_compiler::{compile, review, validate};
//!
//! # fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let raw: serde_json::Value = serde_json::from_str(r#"{
//!     "chain": "ethereum",
//!     "chainId": 1,
//!     "txType": "TRANSFER_NATIVE",
//!     "from": "0x1111111111111111111111111111111111111111",
//!     "to":   "0x2222222222222222222222222222222222222222",
//!     "valueWei": "1000000000000000000",
//!     "nonce": "0",
//!     "fee": {
//!         "mode": "EIP1559",
//!         "gasLimit": "21000",
//!         "maxFeePerGas": "30000000000",
//!         "maxPriorityFeePerGas": "1500000000"
//!     }
//! }"#)?;
//!
//! let prepared = validate(&raw)?;
//! let _review = review(&prepared)?;
//! let result = compile(&prepared, Default::default())?;
//!
//! assert!(result.unsigned_tx.starts_with("0x02")); // EIP-1559 envelope
//! # Ok(())
//! # }
//! # example().unwrap();
//! ```
//!
//! # Determinism
//!
//! The compiler is byte-exact against the pinned canonical fixture set
//! in `tests/fixtures/canonical.json`. Any change that alters compiled
//! bytes must update that fixture and is treated as a hard-failing
//! regression by the CI determinism suite.
#![doc(html_root_url = "https://docs.rs/walletsuite-tx-compiler/0.1.0")]

mod compile;
pub mod constants;
mod error;
mod evm;
mod review;
mod tron;
mod tron_address;
mod tron_proto;
mod types;
mod validate;

pub use crate::compile::compile;
pub use crate::error::{TxCompilerError, TxCompilerErrorCode};
pub use crate::review::review;
pub use crate::tron_address::tron_address_to_bytes;
pub use crate::types::{
    Chain, CompilationMetadata, CompilationResult, CompileOptions, FeeMode, FeeParams, FeeReview,
    PreparedTransaction, TransactionReview, TronBlockHeader, TxType,
};
pub use crate::validate::validate;
