/**
 * Main compilation entry point — dispatches to the chain-specific compiler.
 */

import { TxCompilerError } from './errors.js';
import { compileEvm } from './evm.js';
import { compileTron } from './tron.js';
import type { CompilationResult, CompileOptions, PreparedTransaction } from './types.js';

export function compile(
  prepared: PreparedTransaction,
  options?: CompileOptions,
): CompilationResult {
  switch (prepared.chain) {
    case 'ethereum':
      return compileEvm(prepared);
    case 'tron':
      return compileTron(prepared, options);
    default:
      throw new TxCompilerError(
        'UNSUPPORTED_CHAIN',
        `Unsupported chain: ${prepared.chain as string}`,
      );
  }
}
