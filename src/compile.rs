//! Main compilation entry point — dispatches to the chain-specific compiler.

use crate::error::TxCompilerError;
use crate::evm::compile_evm;
use crate::tron::compile_tron;
use crate::types::{Chain, CompilationResult, CompileOptions, PreparedTransaction};

/// Compile a validated prepared transaction into unsigned signer-ready
/// artifacts.
///
/// The input must have already passed through [`crate::validate`]. Pass
/// `CompileOptions::default()` if no per-call overrides are needed, or
/// use the `CompileOptions::new().with_now(...)` builder to pin the
/// Tron `timestamp` / `expiration` for reproducible output.
pub fn compile(
    prepared: &PreparedTransaction,
    options: CompileOptions,
) -> Result<CompilationResult, TxCompilerError> {
    match prepared.chain {
        Chain::Ethereum => compile_evm(prepared),
        Chain::Tron => compile_tron(prepared, options),
    }
}
