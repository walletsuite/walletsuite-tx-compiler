import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { TxCompilerError } from '../src/errors.js';
import { EVM_NATIVE_EIP1559, EVM_NATIVE_LEGACY } from './fixtures.js';

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

  it('throws for unsupported chains', () => {
    const input = { ...EVM_NATIVE_EIP1559, chain: 'tron' as 'ethereum' | 'tron' };
    expect(() => compile(input)).toThrow(TxCompilerError);
  });
});
