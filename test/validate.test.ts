import { describe, expect, it } from 'vitest';
import { validate } from '../src/validate.js';
import { TxCompilerError } from '../src/errors.js';
import { EVM_NATIVE_EIP1559, EVM_NATIVE_LEGACY } from './fixtures.js';

function omit(obj: object, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
}

function expectError(fn: () => unknown): TxCompilerError {
  try {
    fn();
  } catch (error) {
    if (error instanceof TxCompilerError) return error;
    throw error;
  }

  throw new Error('Expected TxCompilerError');
}

describe('validate', () => {
  it('accepts a valid EIP-1559 native payload', () => {
    const result = validate(EVM_NATIVE_EIP1559);
    expect(result.chain).toBe('ethereum');
    expect(result.txType).toBe('TRANSFER_NATIVE');
    expect(result.fee.mode).toBe('EIP1559');
  });

  it('accepts a valid legacy native payload', () => {
    const result = validate(EVM_NATIVE_LEGACY);
    expect(result.chain).toBe('ethereum');
    expect(result.txType).toBe('TRANSFER_NATIVE');
    expect(result.fee.mode).toBe('LEGACY');
  });

  it('coerces numeric valueWei to string', () => {
    const result = validate({ ...EVM_NATIVE_EIP1559, valueWei: 42 });
    expect(result.valueWei).toBe('42');
  });

  it('rejects unsafe numeric integers during coercion', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, valueWei: unsafe }));
    expect(error.code).toBe('INVALID_AMOUNT');
  });

  it('coerces numeric nonce to string', () => {
    const result = validate({ ...EVM_NATIVE_EIP1559, nonce: 7 });
    expect(result.nonce).toBe('7');
  });

  it('coerces numeric fee fields to strings', () => {
    const result = validate({
      ...EVM_NATIVE_EIP1559,
      fee: { ...EVM_NATIVE_EIP1559.fee, gasLimit: 21000 },
    });
    expect(result.fee.gasLimit).toBe('21000');
  });

  it('rejects null input', () => {
    expect(() => validate(null)).toThrow(TxCompilerError);
  });

  it('rejects non object input', () => {
    expect(() => validate('string')).toThrow(TxCompilerError);
  });

  it('rejects unsupported chains', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, chain: 'tron' }));
    expect(error.code).toBe('UNSUPPORTED_CHAIN');
  });

  it('rejects unsupported transaction types', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, txType: 'TRANSFER_TOKEN' }));
    expect(error.code).toBe('UNSUPPORTED_TX_TYPE');
  });

  it('rejects missing from', () => {
    const error = expectError(() => validate(omit(EVM_NATIVE_EIP1559, 'from')));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects missing to', () => {
    const error = expectError(() => validate(omit(EVM_NATIVE_EIP1559, 'to')));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects invalid valueWei', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, valueWei: '1.5' }));
    expect(error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects missing chainId', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, chainId: null }));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects invalid chainId values', () => {
    expect(expectError(() => validate({ ...EVM_NATIVE_EIP1559, chainId: 0 })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(expectError(() => validate({ ...EVM_NATIVE_EIP1559, chainId: 1.5 })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(
      expectError(() => validate({ ...EVM_NATIVE_EIP1559, chainId: Number.MAX_SAFE_INTEGER + 1 }))
        .code,
    ).toBe('INVALID_PAYLOAD');
    expect(expectError(() => validate({ ...EVM_NATIVE_EIP1559, chainId: '1' })).code).toBe(
      'INVALID_PAYLOAD',
    );
  });

  it('rejects missing nonce', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, nonce: null }));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects nonce values above the safe integer range', () => {
    const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, nonce: huge }));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('accepts nonce at the safe integer limit', () => {
    const input = { ...EVM_NATIVE_EIP1559, nonce: String(Number.MAX_SAFE_INTEGER) };
    expect(validate(input).nonce).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('rejects invalid EVM addresses', () => {
    expect(expectError(() => validate({ ...EVM_NATIVE_EIP1559, from: '0xinvalid' })).code).toBe(
      'INVALID_ADDRESS',
    );
    expect(
      expectError(() => validate({ ...EVM_NATIVE_EIP1559, to: 'not-an-address' })).code,
    ).toBe('INVALID_ADDRESS');
    expect(
      expectError(() => validate({ ...EVM_NATIVE_EIP1559, from: '0xd8dA6BF26964af9D7eEd9e03E53415D37aA96045' }))
        .code,
    ).toBe('INVALID_ADDRESS');
  });

  it('rejects calldata on native transfers', () => {
    const error = expectError(() =>
      validate({ ...EVM_NATIVE_EIP1559, data: '0xdeadbeef' }),
    );
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('accepts empty calldata markers for native transfers', () => {
    expect(validate({ ...EVM_NATIVE_EIP1559, data: '' }).data).toBe('');
    expect(validate({ ...EVM_NATIVE_EIP1559, data: '0x' }).data).toBe('0x');
  });

  it('rejects invalid optional string field types', () => {
    expect(expectError(() => validate({ ...EVM_NATIVE_EIP1559, data: 123 })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(
      expectError(() => validate({ ...EVM_NATIVE_EIP1559, tokenContract: {} })).code,
    ).toBe('INVALID_PAYLOAD');
  });

  it('rejects tokenContract on native transfers', () => {
    const error = expectError(() =>
      validate({
        ...EVM_NATIVE_EIP1559,
        tokenContract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      }),
    );
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects empty tokenContract on native transfers', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, tokenContract: '' }));
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects missing fee object', () => {
    const error = expectError(() => validate(omit(EVM_NATIVE_EIP1559, 'fee')));
    expect(error.code).toBe('MISSING_FEE_PARAMS');
  });

  it('rejects unsupported fee modes', () => {
    const error = expectError(() => validate({ ...EVM_NATIVE_EIP1559, fee: { mode: 'TRON' } }));
    expect(error.code).toBe('UNSUPPORTED_FEE_MODE');
  });

  it('rejects invalid integer fields inside fee', () => {
    const error = expectError(() =>
      validate({
        ...EVM_NATIVE_EIP1559,
        fee: { ...EVM_NATIVE_EIP1559.fee, gasLimit: '21k' },
      }),
    );
    expect(error.code).toBe('INVALID_AMOUNT');
  });

  it('requires EIP-1559 gas fields', () => {
    expect(
      expectError(() =>
        validate({
          ...EVM_NATIVE_EIP1559,
          fee: { ...EVM_NATIVE_EIP1559.fee, gasLimit: null },
        }),
      ).code,
    ).toBe('MISSING_FEE_PARAMS');

    expect(
      expectError(() =>
        validate({
          ...EVM_NATIVE_EIP1559,
          fee: { ...EVM_NATIVE_EIP1559.fee, maxFeePerGas: null },
        }),
      ).code,
    ).toBe('MISSING_FEE_PARAMS');

    expect(
      expectError(() =>
        validate({
          ...EVM_NATIVE_EIP1559,
          fee: { ...EVM_NATIVE_EIP1559.fee, maxPriorityFeePerGas: null },
        }),
      ).code,
    ).toBe('MISSING_FEE_PARAMS');
  });

  it('requires legacy gas pricing', () => {
    expect(
      expectError(() =>
        validate({
          ...EVM_NATIVE_LEGACY,
          fee: { ...EVM_NATIVE_LEGACY.fee, gasLimit: null },
        }),
      ).code,
    ).toBe('MISSING_FEE_PARAMS');

    expect(
      expectError(() =>
        validate({
          ...EVM_NATIVE_LEGACY,
          fee: { ...EVM_NATIVE_LEGACY.fee, gasPrice: null, maxFeePerGas: null },
        }),
      ).code,
    ).toBe('MISSING_FEE_PARAMS');
  });

  it('accepts legacy payloads that use maxFeePerGas as fallback pricing', () => {
    const result = validate({
      ...EVM_NATIVE_LEGACY,
      fee: {
        mode: 'LEGACY',
        gasLimit: '21000',
        gasPrice: null,
        maxFeePerGas: '7000000000',
      },
    });

    expect(result.fee.mode).toBe('LEGACY');
    expect(result.fee.maxFeePerGas).toBe('7000000000');
  });
});
