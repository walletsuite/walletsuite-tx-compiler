import { describe, expect, it, vi } from 'vitest';
import { Transaction } from 'ethers';
import { compileEvm } from '../src/evm.js';
import { TxCompilerError } from '../src/errors.js';
import { EVM_NATIVE_EIP1559, EVM_NATIVE_LEGACY } from './fixtures.js';

describe('compileEvm', () => {
  it('compiles EIP-1559 native transfers', () => {
    const result = compileEvm(EVM_NATIVE_EIP1559);
    expect(result.chain).toBe('ethereum');
    expect(result.unsignedTx).toMatch(/^0x02/);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.metadata.txType).toBe('TRANSFER_NATIVE');
    expect(result.metadata.feeMode).toBe('EIP1559');
    expect(result.metadata.evmTxType).toBe(2);
  });

  it('produces deterministic output for EIP-1559', () => {
    const first = compileEvm(EVM_NATIVE_EIP1559);
    const second = compileEvm(EVM_NATIVE_EIP1559);
    expect(first.unsignedTx).toBe(second.unsignedTx);
    expect(first.txHash).toBe(second.txHash);
  });

  it('round trips EIP-1559 output through ethers', () => {
    const result = compileEvm(EVM_NATIVE_EIP1559);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.chainId).toBe(1n);
    expect(parsed.nonce).toBe(1649);
    expect(parsed.value).toBe(1000000000000000000n);
    expect(parsed.gasLimit).toBe(24338n);
    expect(parsed.maxFeePerGas).toBe(1214529816n);
    expect(parsed.maxPriorityFeePerGas).toBe(1000000000n);
    expect(parsed.type).toBe(2);
  });

  it('compiles legacy native transfers', () => {
    const result = compileEvm(EVM_NATIVE_LEGACY);
    expect(result.chain).toBe('ethereum');
    expect(result.metadata.feeMode).toBe('LEGACY');
    expect(result.metadata.evmTxType).toBe(0);

    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.chainId).toBe(56n);
    expect(parsed.nonce).toBe(42);
    expect(parsed.value).toBe(500000000000000000n);
    expect(parsed.gasLimit).toBe(21000n);
    expect(parsed.gasPrice).toBe(5000000000n);
    expect(parsed.type).toBe(0);
  });

  it('produces deterministic output for legacy', () => {
    const first = compileEvm(EVM_NATIVE_LEGACY);
    const second = compileEvm(EVM_NATIVE_LEGACY);
    expect(first.unsignedTx).toBe(second.unsignedTx);
    expect(first.txHash).toBe(second.txHash);
  });

  it('falls back to maxFeePerGas in legacy mode when gasPrice is missing', () => {
    const input = {
      ...EVM_NATIVE_LEGACY,
      fee: {
        mode: 'LEGACY' as const,
        gasLimit: '21000',
        gasPrice: null,
        maxFeePerGas: '7000000000',
      },
    };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.gasPrice).toBe(7000000000n);
  });

  it('throws without chainId', () => {
    const input = { ...EVM_NATIVE_EIP1559, chainId: null };
    expect(() => compileEvm(input)).toThrow(TxCompilerError);
  });

  it('throws when EIP-1559 maxFeePerGas is missing', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: { ...EVM_NATIVE_EIP1559.fee, maxFeePerGas: null },
    };
    expect(() => compileEvm(input)).toThrow(TxCompilerError);
  });

  it('throws when EIP-1559 maxPriorityFeePerGas is missing', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: { ...EVM_NATIVE_EIP1559.fee, maxPriorityFeePerGas: null },
    };
    expect(() => compileEvm(input)).toThrow(TxCompilerError);
  });

  it('throws for unsupported EVM fee modes', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: {
        mode: 'TRON' as const,
        el: '30000000',
        rp: null,
      },
    };

    try {
      compileEvm(input);
    } catch (error) {
      expect(error).toBeInstanceOf(TxCompilerError);
      expect((error as TxCompilerError).code).toBe('UNSUPPORTED_FEE_MODE');
      expect((error as TxCompilerError).message).toContain('TRON');
      return;
    }

    throw new Error('Expected compileEvm to reject unsupported fee mode');
  });

  it('matches ethers unsignedHash', () => {
    const result = compileEvm(EVM_NATIVE_EIP1559);
    const parsed = Transaction.from(result.unsignedTx);
    expect(result.txHash).toBe(parsed.unsignedHash);
  });

  it('handles zero value transfers', () => {
    const input = { ...EVM_NATIVE_EIP1559, valueWei: '0' };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.value).toBe(0n);
  });

  it('handles large nonces', () => {
    const input = { ...EVM_NATIVE_EIP1559, nonce: '999999' };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.nonce).toBe(999999);
  });

  it('handles large gas values', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: {
        ...EVM_NATIVE_EIP1559.fee,
        gasLimit: '30000000',
        maxFeePerGas: '500000000000',
        maxPriorityFeePerGas: '50000000000',
      },
    };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.gasLimit).toBe(30000000n);
    expect(parsed.maxFeePerGas).toBe(500000000000n);
  });

  it('defaults nonce and gasLimit when they are not provided', () => {
    const input = {
      ...EVM_NATIVE_LEGACY,
      nonce: null,
      data: '0x1234',
      fee: {
        ...EVM_NATIVE_LEGACY.fee,
        gasLimit: null,
      },
    };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.nonce).toBe(0);
    expect(parsed.gasLimit).toBe(21000n);
    expect(parsed.data).toBe('0x1234');
  });

  it('defaults legacy gasPrice to zero when no fee price is present', () => {
    const input = {
      ...EVM_NATIVE_LEGACY,
      fee: {
        mode: 'LEGACY' as const,
        gasLimit: '21000',
        gasPrice: null,
        maxFeePerGas: null,
      },
    };
    const result = compileEvm(input);
    const parsed = Transaction.from(result.unsignedTx);
    expect(parsed.gasPrice).toBe(0n);
  });

  it('rethrows compiler errors raised during transaction assembly', () => {
    const compilerError = new TxCompilerError('COMPILATION_FAILED', 'already typed');
    const spy = vi.spyOn(Transaction, 'from').mockImplementation(() => {
      throw compilerError;
    });

    try {
      expect(() => compileEvm(EVM_NATIVE_EIP1559)).toThrow(compilerError);
    } finally {
      spy.mockRestore();
    }
  });

  it('wraps unexpected errors raised during transaction assembly', () => {
    const spy = vi.spyOn(Transaction, 'from').mockImplementation(() => {
      throw new Error('boom');
    });

    try {
      expect(() => compileEvm(EVM_NATIVE_EIP1559)).toThrow(TxCompilerError);

      try {
        compileEvm(EVM_NATIVE_EIP1559);
      } catch (error) {
        expect(error).toBeInstanceOf(TxCompilerError);
        expect((error as TxCompilerError).code).toBe('COMPILATION_FAILED');
        expect((error as TxCompilerError).details).toEqual({
          cause: 'Error: boom',
        });
      }
    } finally {
      spy.mockRestore();
    }
  });
});
