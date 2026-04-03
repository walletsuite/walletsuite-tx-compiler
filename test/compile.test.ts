import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { TxCompilerError } from '../src/errors.js';
import { compileTron } from '../src/tron.js';
import { EVM_NATIVE_EIP1559, EVM_NATIVE_LEGACY, FIXED_NOW, TRON_NATIVE, TRON_TOKEN } from './fixtures.js';

describe('compile', () => {
  it('dispatches native EIP-1559 transactions to the EVM compiler', () => {
    const result = compile(EVM_NATIVE_EIP1559);
    expect(result.chain).toBe('ethereum');
    expect(result.metadata.evmTxType).toBe(2);
  });

  it('dispatches native legacy transactions to the EVM compiler', () => {
    const result = compile(EVM_NATIVE_LEGACY);
    expect(result.chain).toBe('ethereum');
    expect(result.metadata.evmTxType).toBe(0);
  });

  it('dispatches Tron native transactions to the Tron compiler', () => {
    const result = compile(TRON_NATIVE, { now: FIXED_NOW });
    const direct = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    expect(result.chain).toBe('tron');
    expect(result.metadata.tronContractType).toBe(1);
    expect(result.unsignedTx).toBe(direct.unsignedTx);
    expect(result.txHash).toBe(direct.txHash);
  });

  it('dispatches Tron token transactions to the Tron compiler', () => {
    const result = compile(TRON_TOKEN, { now: FIXED_NOW });
    const direct = compileTron(TRON_TOKEN, { now: FIXED_NOW });
    expect(result.chain).toBe('tron');
    expect(result.metadata.tronContractType).toBe(31);
    expect(result.unsignedTx).toBe(direct.unsignedTx);
    expect(result.txHash).toBe(direct.txHash);
  });

  it('throws for unsupported chains', () => {
    const input = { ...EVM_NATIVE_EIP1559, chain: 'solana' as 'ethereum' | 'tron' };
    expect(() => compile(input)).toThrow(TxCompilerError);
  });
});
