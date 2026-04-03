/**
 * EVM transaction compilation.
 *
 * Converts a prepared Ethereum transaction into an unsigned serialized
 * transaction plus the hash that signers should sign.
 */

import { Transaction, getAddress } from 'ethers';
import { TxCompilerError } from './errors.js';
import type { CompilationResult, PreparedTransaction } from './types.js';

export function compileEvm(prepared: PreparedTransaction): CompilationResult {
  const { fee } = prepared;

  if (fee.mode !== 'EIP1559' && fee.mode !== 'LEGACY') {
    throw new TxCompilerError(
      'UNSUPPORTED_FEE_MODE',
      `${fee.mode} fee mode invalid for ethereum chain`,
    );
  }

  const isEip1559 = fee.mode === 'EIP1559';

  const chainId = prepared.chainId;
  if (chainId == null) {
    throw new TxCompilerError('MISSING_FEE_PARAMS', 'EVM transactions require chainId');
  }

  if (isEip1559 && (fee.maxFeePerGas == null || fee.maxPriorityFeePerGas == null)) {
    throw new TxCompilerError(
      'MISSING_FEE_PARAMS',
      'EIP-1559 requires maxFeePerGas and maxPriorityFeePerGas',
    );
  }

  try {
    const base = {
      chainId,
      nonce: Number(prepared.nonce ?? '0'),
      to: getAddress(prepared.to),
      value: BigInt(prepared.valueWei),
      gasLimit: BigInt(fee.gasLimit ?? '21000'),
      data: prepared.data ?? '0x',
    };

    const tx = isEip1559
      ? Transaction.from({
          ...base,
          type: 2,
          maxFeePerGas: BigInt(fee.maxFeePerGas ?? '0'),
          maxPriorityFeePerGas: BigInt(fee.maxPriorityFeePerGas ?? '0'),
        })
      : Transaction.from({
          ...base,
          type: 0,
          gasPrice: BigInt(fee.gasPrice ?? fee.maxFeePerGas ?? '0'),
        });

    return {
      chain: 'ethereum',
      unsignedTx: tx.unsignedSerialized,
      txHash: tx.unsignedHash,
      metadata: {
        txType: prepared.txType,
        feeMode: fee.mode,
        evmTxType: isEip1559 ? 2 : 0,
      },
    };
  } catch (error) {
    if (error instanceof TxCompilerError) throw error;
    throw new TxCompilerError('COMPILATION_FAILED', `EVM compilation failed: ${String(error)}`, {
      cause: String(error),
    });
  }
}
