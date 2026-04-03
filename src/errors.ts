/** Error codes emitted by the transaction compiler */
export type TxCompilerErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_CHAIN'
  | 'UNSUPPORTED_TX_TYPE'
  | 'UNSUPPORTED_FEE_MODE'
  | 'INVALID_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'MISSING_FEE_PARAMS'
  | 'INVALID_BLOCK_HEADER'
  | 'INVALID_CALLDATA'
  | 'COMPILATION_FAILED';

/**
 * Structured error thrown by all compiler operations.
 *
 * `code` is a machine-readable discriminator suitable for programmatic
 * handling. `details` carries context useful for debugging.
 */
export class TxCompilerError extends Error {
  override readonly name = 'TxCompilerError';

  constructor(
    readonly code: TxCompilerErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
