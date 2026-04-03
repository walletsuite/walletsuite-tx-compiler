import { describe, expect, it } from 'vitest';
import { TxCompilerError } from '../src/errors.js';
import { compileTron } from '../src/tron.js';
import { FIXED_NOW, TRON_BLOCK_HEADER, TRON_NATIVE, TRON_TOKEN } from './fixtures.js';

describe('compileTron', () => {
  it('compiles Tron native transfers', () => {
    const result = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    expect(result.chain).toBe('tron');
    expect(result.unsignedTx).toMatch(/^0x[0-9a-f]+$/);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.metadata.txType).toBe('TRANSFER_NATIVE');
    expect(result.metadata.feeMode).toBe('TRON');
    expect(result.metadata.tronContractType).toBe(1);
  });

  it('compiles Tron token transfers', () => {
    const result = compileTron(TRON_TOKEN, { now: FIXED_NOW });
    expect(result.chain).toBe('tron');
    expect(result.unsignedTx).toMatch(/^0x[0-9a-f]+$/);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.metadata.txType).toBe('TRANSFER_TOKEN');
    expect(result.metadata.tronContractType).toBe(31);
  });

  it('uses block timestamp plus ten hours for expiration', () => {
    const result = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    expect(result.metadata.expiration).toBe(TRON_BLOCK_HEADER.t + 10 * 60 * 60 * 1000);
  });

  it('is deterministic with a fixed timestamp', () => {
    const first = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    const second = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    expect(first.unsignedTx).toBe(second.unsignedTx);
    expect(first.txHash).toBe(second.txHash);
  });

  it('changes output when the timestamp changes', () => {
    const first = compileTron(TRON_NATIVE, { now: FIXED_NOW });
    const second = compileTron(TRON_NATIVE, { now: FIXED_NOW + 1000 });
    expect(first.unsignedTx).not.toBe(second.unsignedTx);
    expect(first.txHash).not.toBe(second.txHash);
  });

  it('rejects stale headers that already expired at compile time', () => {
    const expiredAt = TRON_BLOCK_HEADER.t + 10 * 60 * 60 * 1000;
    expect(catchError(() => compileTron(TRON_NATIVE, { now: expiredAt })).code).toBe(
      'INVALID_BLOCK_HEADER',
    );
  });

  it('uses Date.now() when no override is provided', () => {
    const originalNow = Date.now;
    Date.now = () => FIXED_NOW;

    try {
      const result = compileTron(TRON_NATIVE);
      expect(result.unsignedTx).toMatch(/^0x[0-9a-f]+$/);
      expect(result.metadata.expiration).toBe(TRON_BLOCK_HEADER.t + 10 * 60 * 60 * 1000);
    } finally {
      Date.now = originalNow;
    }
  });

  it('compiles native transfers without a fee limit', () => {
    const result = compileTron({ ...TRON_NATIVE, fee: { ...TRON_NATIVE.fee, el: null } }, { now: FIXED_NOW });
    expect(result.unsignedTx).toMatch(/^0x[0-9a-f]+$/);
  });

  it('rejects missing or malformed block headers', () => {
    expect(catchError(() => compileTron({ ...TRON_NATIVE, fee: { ...TRON_NATIVE.fee, rp: null } })).code).toBe(
      'INVALID_BLOCK_HEADER',
    );
    expect(
      catchError(() =>
        compileTron({
          ...TRON_NATIVE,
          fee: { ...TRON_NATIVE.fee, rp: { ...TRON_BLOCK_HEADER, h: 'short' } },
        }),
      ).code,
    ).toBe('INVALID_BLOCK_HEADER');
  });

  it('rejects unsupported fee modes and payload shape violations', () => {
    expect(catchError(() => compileTron({ ...TRON_NATIVE, fee: { mode: 'LEGACY' as const } })).code).toBe(
      'UNSUPPORTED_FEE_MODE',
    );
    expect(catchError(() => compileTron({ ...TRON_NATIVE, tokenContract: TRON_TOKEN.tokenContract }, { now: FIXED_NOW })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(catchError(() => compileTron({ ...TRON_NATIVE, data: '0xdeadbeef' }, { now: FIXED_NOW })).code).toBe(
      'INVALID_PAYLOAD',
    );
    expect(catchError(() => compileTron({ ...TRON_TOKEN, tokenContract: null }, { now: FIXED_NOW })).code).toBe(
      'INVALID_PAYLOAD',
    );
  });

  it('rejects invalid timestamps and overflowing token amounts', () => {
    expect(catchError(() => compileTron(TRON_NATIVE, { now: -1 })).code).toBe('INVALID_PAYLOAD');

    const overflow = ((1n << 256n) + 1n).toString();
    expect(catchError(() => compileTron({ ...TRON_TOKEN, valueWei: overflow }, { now: FIXED_NOW })).code).toBe(
      'INVALID_AMOUNT',
    );
  });
});

function catchError(fn: () => unknown): TxCompilerError {
  try {
    fn();
  } catch (error) {
    if (error instanceof TxCompilerError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected TxCompilerError');
}
