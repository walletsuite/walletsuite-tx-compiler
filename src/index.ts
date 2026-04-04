/**
 * Public bootstrap surface for the WalletSuite TX Compiler package.
 *
 * Feature modules land incrementally in subsequent commits.
 */

export { TxCompilerError } from './errors.js';
export type { TxCompilerErrorCode } from './errors.js';
export { decodeCalldata, decodeTokenTransfer } from './calldata.js';
export { compile } from './compile.js';
export { review } from './review.js';
export { hexToTronAddress, isValidTronAddress, tronAddressToBytes } from './tron-address.js';
export { validate } from './validate.js';

export type {
  AbiParamType,
  Chain,
  CompilationMetadata,
  CompilationResult,
  CompileOptions,
  DecodedCalldata,
  DecodedParam,
  DecodedTokenTransfer,
  FeeMode,
  FeeParams,
  FeeReview,
  PreparedTransaction,
  TransactionReview,
  TronBlockHeader,
  TxType,
} from './types.js';
