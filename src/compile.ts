/**
 * Main compilation entry point.
 *
 * This stage wires the Ethereum compiler first.
 * Additional chains land in later commits.
 */

import { TxCompilerError } from './errors.js';
import { compileEvm } from './evm.js';
import type { CompilationResult, CompileOptions, PreparedTransaction } from './types.js';

export function compile(
  prepared: PreparedTransaction,
  _options?: CompileOptions,
): CompilationResult {
  switch (prepared.chain) {
    case 'ethereum':
      return compileEvm(prepared);
    default:
      throw new TxCompilerError(
        'UNSUPPORTED_CHAIN',
        `Unsupported chain: ${prepared.chain as string}`,
      );
  }
}
