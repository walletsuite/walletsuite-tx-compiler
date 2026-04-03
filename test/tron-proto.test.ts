import { describe, expect, it } from 'vitest';
import { TxCompilerError } from '../src/errors.js';
import {
  concat,
  encodeRawData,
  encodeTransferContract,
  encodeTriggerSmartContract,
  encodeVarint,
} from '../src/tron-proto.js';

describe('tron-proto', () => {
  describe('encodeVarint', () => {
    it('rejects negative input', () => {
      expect(catchError(() => encodeVarint(-1n)).code).toBe('INVALID_PAYLOAD');
    });

    it('encodes zero', () => {
      expect(encodeVarint(0n)).toEqual(new Uint8Array([0]));
    });

    it('encodes small values into a single byte', () => {
      expect(encodeVarint(1n)).toEqual(new Uint8Array([1]));
      expect(encodeVarint(127n)).toEqual(new Uint8Array([127]));
    });

    it('encodes 128 into two bytes', () => {
      expect(encodeVarint(128n)).toEqual(new Uint8Array([0x80, 0x01]));
    });

    it('encodes 300 into two bytes', () => {
      expect(encodeVarint(300n)).toEqual(new Uint8Array([0xac, 0x02]));
    });

    it('round trips large values', () => {
      expect(decodeVarint(encodeVarint(5000000n))).toBe(5000000n);
    });

    it('round trips timestamp sized values', () => {
      expect(decodeVarint(encodeVarint(1710000000000n))).toBe(1710000000000n);
    });
  });

  describe('concat', () => {
    it('handles no arrays', () => {
      expect(concat()).toEqual(new Uint8Array(0));
    });

    it('returns the same bytes for one array', () => {
      const input = new Uint8Array([1, 2, 3]);
      expect(concat(input)).toEqual(input);
    });

    it('joins multiple arrays in order', () => {
      expect(concat(new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5]))).toEqual(
        new Uint8Array([1, 2, 3, 4, 5]),
      );
    });
  });

  describe('encodeTransferContract', () => {
    it('produces stable non empty output', () => {
      const owner = new Uint8Array(21).fill(0x41);
      const to = new Uint8Array(21).fill(0x42);

      const result = encodeTransferContract(owner, to, 1000n);

      expect(result.length).toBeGreaterThan(0);
      expect(encodeTransferContract(owner, to, 1000n)).toEqual(result);
    });

    it('changes with different amounts and recipients', () => {
      const owner = new Uint8Array(21).fill(0x01);
      const toA = new Uint8Array(21).fill(0x02);
      const toB = new Uint8Array(21).fill(0x03);

      expect(encodeTransferContract(owner, toA, 1000n)).not.toEqual(
        encodeTransferContract(owner, toA, 2000n),
      );
      expect(encodeTransferContract(owner, toA, 1000n)).not.toEqual(
        encodeTransferContract(owner, toB, 1000n),
      );
    });

    it('rejects invalid address lengths', () => {
      expect(
        catchError(() => encodeTransferContract(new Uint8Array(20), new Uint8Array(21), 1n)).code,
      ).toBe('INVALID_ADDRESS');
      expect(
        catchError(() => encodeTransferContract(new Uint8Array(21), new Uint8Array(22), 1n)).code,
      ).toBe('INVALID_ADDRESS');
    });

    it('rejects negative amounts', () => {
      expect(
        catchError(() => encodeTransferContract(new Uint8Array(21), new Uint8Array(21), -1n)).code,
      ).toBe('INVALID_AMOUNT');
    });
  });

  describe('encodeTriggerSmartContract', () => {
    it('produces stable non empty output', () => {
      const owner = new Uint8Array(21).fill(0x41);
      const contract = new Uint8Array(21).fill(0x42);
      const data = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb]);

      const result = encodeTriggerSmartContract(owner, contract, data);

      expect(result.length).toBeGreaterThan(0);
      expect(encodeTriggerSmartContract(owner, contract, data)).toEqual(result);
    });

    it('rejects invalid contract input', () => {
      expect(
        catchError(() =>
          encodeTriggerSmartContract(new Uint8Array(20), new Uint8Array(21), new Uint8Array([1])),
        ).code,
      ).toBe('INVALID_ADDRESS');
      expect(
        catchError(() =>
          encodeTriggerSmartContract(new Uint8Array(21), new Uint8Array(20), new Uint8Array([1])),
        ).code,
      ).toBe('INVALID_ADDRESS');
      expect(
        catchError(() =>
          encodeTriggerSmartContract(new Uint8Array(21), new Uint8Array(21), new Uint8Array()),
        ).code,
      ).toBe('INVALID_CALLDATA');
    });
  });

  describe('encodeRawData', () => {
    const baseParams = {
      refBlockBytes: new Uint8Array([0xe4, 0xb2]),
      refBlockHash: new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0xa7, 0xb8]),
      expiration: 1710036000000,
      timestamp: 1710000060000,
      contract: new Uint8Array(50).fill(0xcc),
    };

    it('produces stable non empty output', () => {
      const result = encodeRawData(baseParams);
      expect(result.length).toBeGreaterThan(0);
      expect(encodeRawData(baseParams)).toEqual(result);
    });

    it('includes feeLimit only when positive', () => {
      const withoutFee = encodeRawData(baseParams);

      expect(encodeRawData({ ...baseParams, feeLimit: 30000000n }).length).toBeGreaterThan(
        withoutFee.length,
      );
      expect(encodeRawData({ ...baseParams, feeLimit: 0n })).toEqual(withoutFee);
      expect(encodeRawData({ ...baseParams, feeLimit: undefined })).toEqual(withoutFee);
    });

    it('changes with different timestamps', () => {
      expect(encodeRawData(baseParams)).not.toEqual(
        encodeRawData({ ...baseParams, timestamp: baseParams.timestamp + 1000 }),
      );
    });

    it('rejects invalid block reference shapes', () => {
      expect(
        catchError(() => encodeRawData({ ...baseParams, refBlockBytes: new Uint8Array([1]) })).code,
      ).toBe('INVALID_BLOCK_HEADER');
      expect(
        catchError(() =>
          encodeRawData({ ...baseParams, refBlockHash: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) }),
        ).code,
      ).toBe('INVALID_BLOCK_HEADER');
    });

    it('rejects invalid transaction timing and contract data', () => {
      expect(catchError(() => encodeRawData({ ...baseParams, expiration: -1 })).code).toBe(
        'INVALID_PAYLOAD',
      );
      expect(
        catchError(() => encodeRawData({ ...baseParams, timestamp: Number.MAX_SAFE_INTEGER + 1 }))
          .code,
      ).toBe('INVALID_PAYLOAD');
      expect(
        catchError(() => encodeRawData({ ...baseParams, contract: new Uint8Array() })).code,
      ).toBe('INVALID_PAYLOAD');
    });

    it('rejects negative fee limits', () => {
      expect(catchError(() => encodeRawData({ ...baseParams, feeLimit: -1n })).code).toBe(
        'INVALID_AMOUNT',
      );
    });
  });
});

function decodeVarint(bytes: Uint8Array): bigint {
  let result = 0n;

  for (let index = 0; index < bytes.length; index++) {
    result |= BigInt((bytes[index] ?? 0) & 0x7f) << BigInt(index * 7);
  }

  return result;
}

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
