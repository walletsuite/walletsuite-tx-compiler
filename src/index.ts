/**
 * Public bootstrap surface for the WalletSuite TX Compiler package.
 *
 * Feature modules land incrementally in subsequent commits.
 */

export { TxCompilerError } from './errors.js';
export type { TxCompilerErrorCode } from './errors.js';
export { compile } from './compile.js';
export { review } from './review.js';
export { validate } from './validate.js';

export type {
  Chain,
  CompilationMetadata,
  CompilationResult,
  CompileOptions,
  FeeMode,
  FeeParams,
  FeeReview,
  PreparedTransaction,
  TransactionReview,
  TronBlockHeader,
  TxType,
} from './types.js';
