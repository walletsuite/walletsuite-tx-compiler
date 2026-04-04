import { describe, expect, it } from 'vitest';
import { decodeCalldata, decodeTokenTransfer } from '../src/calldata.js';
import { TxCompilerError } from '../src/errors.js';

// transfer(address,uint256): to=0x0000...0001, value=1000000
const TRANSFER_CALLDATA =
  '0xa9059cbb' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '00000000000000000000000000000000000000000000000000000000000f4240';

// approve(address,uint256): spender=0xdAC17F...1ec7, value=max uint256
const APPROVE_CALLDATA =
  '0x095ea7b3' +
  '000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7' +
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// transferFrom(address,address,uint256): from=0x0...01, to=0x0...02, value=500
const TRANSFER_FROM_CALLDATA =
  '0x23b872dd' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000002' +
  '00000000000000000000000000000000000000000000000000000000000001f4';

// Tron: transfer(address,uint256): to address resolves to a real Tron address
// Using 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 as the raw 20 bytes
const TRON_TRANSFER_CALLDATA =
  '0xa9059cbb' +
  '000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045' +
  '00000000000000000000000000000000000000000000000000000000000f4240';

describe('decodeCalldata', () => {
  it('decodes transfer(address,uint256)', () => {
    const result = decodeCalldata(TRANSFER_CALLDATA);
    expect(result.selector).toBe('a9059cbb');
    expect(result.name).toBe('transfer');
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toEqual({
      name: 'to',
      type: 'address',
      value: '0x0000000000000000000000000000000000000001',
    });
    expect(result.params[1]).toEqual({
      name: 'value',
      type: 'uint256',
      value: '1000000',
    });
  });

  it('decodes approve(address,uint256)', () => {
    const result = decodeCalldata(APPROVE_CALLDATA);
    expect(result.selector).toBe('095ea7b3');
    expect(result.name).toBe('approve');
    expect(result.params).toHaveLength(2);
    expect(result.params[0]).toEqual({
      name: 'spender',
      type: 'address',
      value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    });
    expect(result.params[1]).toEqual({
      name: 'value',
      type: 'uint256',
      value: (2n ** 256n - 1n).toString(),
    });
  });

  it('decodes transferFrom(address,address,uint256)', () => {
    const result = decodeCalldata(TRANSFER_FROM_CALLDATA);
    expect(result.selector).toBe('23b872dd');
    expect(result.name).toBe('transferFrom');
    expect(result.params).toHaveLength(3);
    expect(result.params[0]).toMatchObject({ name: 'from', type: 'address' });
    expect(result.params[1]).toMatchObject({ name: 'to', type: 'address' });
    expect(result.params[2]).toEqual({
      name: 'value',
      type: 'uint256',
      value: '500',
    });
  });

  it('returns null name and empty params for unknown selectors', () => {
    const unknownCalldata = '0xdeadbeef' + '00'.repeat(32);
    const result = decodeCalldata(unknownCalldata);
    expect(result.selector).toBe('deadbeef');
    expect(result.name).toBeNull();
    expect(result.params).toEqual([]);
  });

  it('accepts calldata without 0x prefix', () => {
    const noPrefixData = TRANSFER_CALLDATA.slice(2);
    const result = decodeCalldata(noPrefixData);
    expect(result.selector).toBe('a9059cbb');
    expect(result.name).toBe('transfer');
  });

  it('rejects empty calldata', () => {
    expect(() => decodeCalldata('')).toThrow(TxCompilerError);
    expect(() => decodeCalldata('0x')).toThrow(TxCompilerError);
  });

  it('rejects calldata shorter than 4 bytes', () => {
    expect(catchError(() => decodeCalldata('0xaabb')).code).toBe('INVALID_CALLDATA');
  });

  it('rejects non-hex calldata', () => {
    expect(catchError(() => decodeCalldata('0xZZZZZZZZ')).code).toBe('INVALID_CALLDATA');
  });

  it('rejects odd-length hex', () => {
    expect(catchError(() => decodeCalldata('0xa9059cbb0')).code).toBe('INVALID_CALLDATA');
  });

  it('rejects known selector with wrong parameter length', () => {
    const truncated = TRANSFER_CALLDATA.slice(0, -16);
    expect(catchError(() => decodeCalldata(truncated)).code).toBe('INVALID_CALLDATA');
  });

  it('rejects address with non-zero upper bytes', () => {
    const bad =
      '0xa9059cbb' +
      '0000000000000000000000010000000000000000000000000000000000000001' +
      '00000000000000000000000000000000000000000000000000000000000f4240';
    expect(catchError(() => decodeCalldata(bad)).code).toBe('INVALID_CALLDATA');
  });
});

describe('decodeTokenTransfer', () => {
  describe('ethereum', () => {
    it('decodes ERC-20 transfer with checksummed address', () => {
      const result = decodeTokenTransfer(TRON_TRANSFER_CALLDATA, 'ethereum');
      expect(result.recipient).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      expect(result.amount).toBe('1000000');
    });

    it('decodes transfer to low address', () => {
      const result = decodeTokenTransfer(TRANSFER_CALLDATA, 'ethereum');
      expect(result.recipient).toBe('0x0000000000000000000000000000000000000001');
      expect(result.amount).toBe('1000000');
    });
  });

  describe('tron', () => {
    it('decodes TRC-20 transfer with base58 address', () => {
      const result = decodeTokenTransfer(TRON_TRANSFER_CALLDATA, 'tron');
      expect(result.recipient).toMatch(/^T/);
      expect(result.amount).toBe('1000000');
    });

    it('returns a valid Tron address', () => {
      const result = decodeTokenTransfer(TRON_TRANSFER_CALLDATA, 'tron');
      // Tron base58check addresses are 34 characters
      expect(result.recipient).toHaveLength(34);
    });
  });

  it('rejects non-transfer selectors', () => {
    expect(catchError(() => decodeTokenTransfer(APPROVE_CALLDATA, 'ethereum')).code).toBe(
      'INVALID_CALLDATA',
    );
  });

  it('rejects unknown selectors', () => {
    const unknownCalldata =
      '0xdeadbeef' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '00000000000000000000000000000000000000000000000000000000000f4240';
    expect(catchError(() => decodeTokenTransfer(unknownCalldata, 'ethereum')).code).toBe(
      'INVALID_CALLDATA',
    );
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
