import { describe, expect, it } from 'vitest';
import { review } from '../src/review.js';
import { TxCompilerError } from '../src/errors.js';
import {
  EVM_NATIVE_EIP1559,
  EVM_NATIVE_LEGACY,
  EVM_TOKEN_EIP1559,
  TRON_NATIVE,
  TRON_TOKEN,
} from './fixtures.js';

describe('review', () => {
  it('reviews EVM native transfers', () => {
    const result = review(EVM_NATIVE_EIP1559);
    expect(result.chain).toBe('ethereum');
    expect(result.txType).toBe('TRANSFER_NATIVE');
    expect(result.from).toBe(EVM_NATIVE_EIP1559.from);
    expect(result.recipient).toBe(EVM_NATIVE_EIP1559.to);
    expect(result.amount).toBe(EVM_NATIVE_EIP1559.valueWei);
    expect(result.tokenContract).toBeNull();
    expect(result.nonce).toBe('1649');
    expect(result.chainId).toBe(1);
  });

  it('accepts empty calldata markers on native transfers', () => {
    expect(review({ ...EVM_NATIVE_EIP1559, data: '' }).amount).toBe(EVM_NATIVE_EIP1559.valueWei);
    expect(review({ ...EVM_NATIVE_EIP1559, data: '0x' }).amount).toBe(EVM_NATIVE_EIP1559.valueWei);
  });

  it('reviews EVM token transfers and decodes calldata', () => {
    const result = review(EVM_TOKEN_EIP1559);
    expect(result.chain).toBe('ethereum');
    expect(result.txType).toBe('TRANSFER_TOKEN');
    expect(result.recipient).toBe('0x0000000000000000000000000000000000000001');
    expect(result.amount).toBe('1000000');
    expect(result.tokenContract).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
  });

  it('uses the transaction target as tokenContract when the tokenContract field is absent', () => {
    const result = review({ ...EVM_TOKEN_EIP1559, tokenContract: null });
    expect(result.tokenContract).toBe(EVM_TOKEN_EIP1559.to);
  });

  it('rejects mismatched token contract fields', () => {
    const input = {
      ...EVM_TOKEN_EIP1559,
      tokenContract: '0x0000000000000000000000000000000000000002',
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('rejects tokenContract on native transfers', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      tokenContract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('rejects unsupported chains', () => {
    const input = { ...EVM_NATIVE_EIP1559, chain: 'tron' as const };
    expect(() => review(input)).toThrow(TxCompilerError);
  });

  it('rejects unsupported transaction types', () => {
    const input = { ...EVM_NATIVE_EIP1559, txType: 'SWAP' as 'TRANSFER_NATIVE' | 'TRANSFER_TOKEN' };
    expect(() => review(input)).toThrow(TxCompilerError);
  });

  it('throws when token calldata is missing', () => {
    const input = { ...EVM_TOKEN_EIP1559, data: null };
    expect(() => review(input)).toThrow(TxCompilerError);
  });

  it('throws when token calldata selector is wrong', () => {
    const input = {
      ...EVM_TOKEN_EIP1559,
      data: '0xdeadbeef000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4240',
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_CALLDATA');
  });

  it('throws when token calldata is too short', () => {
    const input = { ...EVM_TOKEN_EIP1559, data: '0xa9059cbb0000' };
    expect(catchError(() => review(input)).code).toBe('INVALID_CALLDATA');
  });

  it('throws when token calldata has trailing bytes', () => {
    const data = EVM_TOKEN_EIP1559.data;
    if (data == null) {
      throw new Error('Expected token fixture to include calldata');
    }

    const input = { ...EVM_TOKEN_EIP1559, data: data + 'deadbeef' };
    expect(catchError(() => review(input)).code).toBe('INVALID_CALLDATA');
  });

  it('throws when token calldata contains non hex data', () => {
    const input = {
      ...EVM_TOKEN_EIP1559,
      data:
        '0xa9059cbb' +
        '0000000000000000000000003333333333333333333333333333333333333333' +
        '000000000000000000000000000000000000000000000000000000000000000z',
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_CALLDATA');
  });

  it('rejects calldata on native transfers', () => {
    const input = { ...EVM_NATIVE_EIP1559, data: '0xdeadbeef' };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('throws when token calldata address padding is non zero', () => {
    const input = {
      ...EVM_TOKEN_EIP1559,
      data:
        '0xa9059cbb' +
        '0000000000000000000000010000000000000000000000000000000000000001' +
        '00000000000000000000000000000000000000000000000000000000000f4240',
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_CALLDATA');
  });

  it('rejects invalid EVM addresses', () => {
    const input = { ...EVM_NATIVE_EIP1559, from: '0xinvalid' };
    expect(catchError(() => review(input)).code).toBe('INVALID_ADDRESS');
  });

  it('rejects invalid chainId values', () => {
    const input = { ...EVM_NATIVE_EIP1559, chainId: 0 };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('rejects missing nonce values', () => {
    const input = { ...EVM_NATIVE_EIP1559, nonce: null };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('rejects native value on token transfers', () => {
    const input = { ...EVM_TOKEN_EIP1559, valueWei: '1' };
    expect(catchError(() => review(input)).code).toBe('INVALID_PAYLOAD');
  });

  it('reviews Tron native transfers', () => {
    const result = review(TRON_NATIVE);
    expect(result.chain).toBe('tron');
    expect(result.txType).toBe('TRANSFER_NATIVE');
    expect(result.recipient).toBe(TRON_NATIVE.to);
    expect(result.amount).toBe(TRON_NATIVE.valueWei);
    expect(result.tokenContract).toBeNull();
    expect(result.nonce).toBeNull();
    expect(result.chainId).toBeNull();
  });

  it('reviews Tron token transfers', () => {
    const result = review(TRON_TOKEN);
    expect(result.chain).toBe('tron');
    expect(result.txType).toBe('TRANSFER_TOKEN');
    expect(result.recipient).toBe(TRON_TOKEN.to);
    expect(result.amount).toBe(TRON_TOKEN.valueWei);
    expect(result.tokenContract).toBe(TRON_TOKEN.tokenContract);
  });

  it('rejects invalid Tron review payloads', () => {
    expect(catchError(() => review({ ...TRON_NATIVE, from: '0xinvalid' })).code).toBe(
      'INVALID_ADDRESS',
    );
    expect(catchError(() => review({ ...TRON_NATIVE, data: '0xdeadbeef' })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(
      catchError(() => review({ ...TRON_NATIVE, tokenContract: TRON_TOKEN.tokenContract })).code,
    ).toBe('INVALID_PAYLOAD');
    expect(catchError(() => review({ ...TRON_TOKEN, tokenContract: null })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(catchError(() => review({ ...TRON_NATIVE, chainId: 1 })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(catchError(() => review({ ...TRON_NATIVE, nonce: '1' })).code).toBe(
      'INVALID_PAYLOAD',
    );
  });

  it('builds EIP-1559 fee review values', () => {
    const result = review(EVM_NATIVE_EIP1559);
    expect(result.fee.mode).toBe('EIP1559');
    expect(result.fee.estimatedMaxCost).toBe((24338n * 1214529816n).toString());
    expect(result.fee.gasLimit).toBe('24338');
    expect(result.fee.maxFeePerGas).toBe('1214529816');
    expect(result.fee.maxPriorityFeePerGas).toBe('1000000000');
    expect(result.fee.baseFeePerGas).toBe('107264908');
  });

  it('builds legacy fee review values', () => {
    const result = review(EVM_NATIVE_LEGACY);
    expect(result.fee.mode).toBe('LEGACY');
    expect(result.fee.estimatedMaxCost).toBe((21000n * 5000000000n).toString());
    expect(result.fee.gasLimit).toBe('21000');
    expect(result.fee.gasPrice).toBe('5000000000');
  });

  it('falls back to maxFeePerGas for legacy fee review when gasPrice is missing', () => {
    const input = {
      ...EVM_NATIVE_LEGACY,
      fee: {
        mode: 'LEGACY' as const,
        gasLimit: '21000',
        gasPrice: null,
        maxFeePerGas: '7000000000',
      },
    };
    const result = review(input);
    expect(result.fee.estimatedMaxCost).toBe((21000n * 7000000000n).toString());
    expect(result.fee.gasPrice).toBe('7000000000');
  });

  it('builds Tron fee review values', () => {
    const result = review(TRON_TOKEN);
    expect(result.fee.mode).toBe('TRON');
    expect(result.fee.estimatedMaxCost).toBe('30000000');
    expect(result.fee.tronFeeLimit).toBe('30000000');
  });

  it('returns null estimated fee when Tron fee limit is absent', () => {
    const result = review(TRON_NATIVE);
    expect(result.fee.estimatedMaxCost).toBeNull();
    expect(result.fee.tronFeeLimit).toBeUndefined();
  });

  it('rejects missing Tron block headers and wrong fee modes', () => {
    expect(catchError(() => review({ ...TRON_NATIVE, fee: { ...TRON_NATIVE.fee, rp: null } })).code).toBe(
      'INVALID_BLOCK_HEADER',
    );
    expect(catchError(() => review({ ...TRON_NATIVE, fee: { mode: 'LEGACY' as const } })).code).toBe(
      'UNSUPPORTED_FEE_MODE',
    );
  });

  it('rejects missing EIP-1559 fee fields', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: {
        ...EVM_NATIVE_EIP1559.fee,
        gasLimit: null,
      },
    };
    expect(catchError(() => review(input)).code).toBe('MISSING_FEE_PARAMS');
  });

  it('rejects invalid fee field values', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: {
        ...EVM_NATIVE_EIP1559.fee,
        gasLimit: '21k',
      },
    };
    expect(catchError(() => review(input)).code).toBe('INVALID_AMOUNT');
  });

  it('rejects unsupported fee modes', () => {
    const input = {
      ...EVM_NATIVE_EIP1559,
      fee: {
        mode: 'TRON' as const,
        el: '30000000',
        rp: null,
      },
    };
    expect(() => review(input)).toThrow(TxCompilerError);
  });
});

function catchError(fn: () => unknown): TxCompilerError {
  try {
    fn();
  } catch (error) {
    if (error instanceof TxCompilerError) return error;
    throw error;
  }

  throw new Error('Expected TxCompilerError');
}
