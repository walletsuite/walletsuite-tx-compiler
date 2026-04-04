import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToTronAddress, isValidTronAddress, tronAddressToBytes } from '../src/tron-address.js';
import { TxCompilerError } from '../src/errors.js';

const B58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58CheckEncode(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const data = new Uint8Array(payload.length + checksum.length);
  data.set(payload);
  data.set(checksum, payload.length);

  let num = 0n;
  for (const byte of data) {
    num = num * 256n + BigInt(byte);
  }

  let encoded = '';
  while (num > 0n) {
    encoded = B58_CHARS[Number(num % 58n)] + encoded;
    num /= 58n;
  }

  for (const byte of data) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }

  return encoded;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

const KNOWN_HEX = '41d8da6bf26964af9d7eed9e03e53415d37aa96045';
const KNOWN_BYTES = hexToBytes(KNOWN_HEX);
const KNOWN_T_ADDRESS = base58CheckEncode(KNOWN_BYTES);

describe('tronAddressToBytes', () => {
  it('converts 41 prefixed hex addresses to bytes', () => {
    const bytes = tronAddressToBytes(KNOWN_HEX);
    expect(bytes).toEqual(KNOWN_BYTES);
  });

  it('accepts uppercase and 0x prefixed hex input', () => {
    expect(tronAddressToBytes(KNOWN_HEX.toUpperCase())).toEqual(KNOWN_BYTES);
    expect(tronAddressToBytes('0x' + KNOWN_HEX)).toEqual(KNOWN_BYTES);
  });

  it('decodes T prefix base58check addresses to the same bytes', () => {
    expect(tronAddressToBytes(KNOWN_T_ADDRESS)).toEqual(KNOWN_BYTES);
  });

  it('round trips multiple base58check addresses', () => {
    const values = [
      '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      '41d8da6bf26964af9d7eed9e03e53415d37aa96045',
      '410000000000000000000000000000000000000001',
    ];

    for (const value of values) {
      const payload = hexToBytes(value);
      expect(tronAddressToBytes(base58CheckEncode(payload))).toEqual(payload);
    }
  });

  it('rejects empty strings', () => {
    expect(() => tronAddressToBytes('')).toThrow(TxCompilerError);
  });

  it('rejects non Tron hex addresses', () => {
    expect(() => tronAddressToBytes('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toThrow(
      TxCompilerError,
    );
  });

  it('rejects malformed hex addresses', () => {
    expect(() => tronAddressToBytes('41d8da6b')).toThrow(TxCompilerError);
    expect(() => tronAddressToBytes('41zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toThrow(
      TxCompilerError,
    );
  });

  it('rejects malformed T prefix addresses', () => {
    expect(() => tronAddressToBytes('TShort')).toThrow(TxCompilerError);
    expect(() => tronAddressToBytes('T0OlIinvalidBase58Address')).toThrow(TxCompilerError);
  });

  it('rejects base58 addresses with bad checksum', () => {
    const lastChar = KNOWN_T_ADDRESS.slice(-1);
    const replacement = lastChar === 'a' ? 'b' : 'a';
    expect(() => tronAddressToBytes(KNOWN_T_ADDRESS.slice(0, -1) + replacement)).toThrow(
      TxCompilerError,
    );
  });

  it('rejects base58 payloads with the wrong network prefix', () => {
    const badPayload = hexToBytes('42d8da6bf26964af9d7eed9e03e53415d37aa96045');
    expect(() => tronAddressToBytes(base58CheckEncode(badPayload))).toThrow(TxCompilerError);
  });

  it('rejects base58 payloads with the wrong byte length', () => {
    const shortPayload = hexToBytes('41d8da6bf26964af9d7eed9e03e53415d37aa960');
    expect(() => tronAddressToBytes(base58CheckEncode(shortPayload))).toThrow(TxCompilerError);
  });

  it('returns INVALID_ADDRESS details for bad input', () => {
    try {
      tronAddressToBytes('invalid');
    } catch (error) {
      expect(error).toBeInstanceOf(TxCompilerError);
      expect((error as TxCompilerError).code).toBe('INVALID_ADDRESS');
      expect((error as TxCompilerError).details).toEqual({ address: 'invalid' });
      return;
    }

    throw new Error('Expected TxCompilerError');
  });
});

describe('hexToTronAddress', () => {
  it('converts 20-byte hex to a base58 T-address', () => {
    const hex20 = KNOWN_HEX.slice(2); // strip the 41 prefix
    const result = hexToTronAddress(hex20);
    expect(result).toBe(KNOWN_T_ADDRESS);
  });

  it('accepts 0x prefix', () => {
    const hex20 = '0x' + KNOWN_HEX.slice(2);
    expect(hexToTronAddress(hex20)).toBe(KNOWN_T_ADDRESS);
  });

  it('round-trips with tronAddressToBytes', () => {
    const hex20 = KNOWN_HEX.slice(2);
    const tAddress = hexToTronAddress(hex20);
    const bytes = tronAddressToBytes(tAddress);
    expect(bytes).toEqual(KNOWN_BYTES);
  });

  it('rejects hex that is not 20 bytes', () => {
    expect(() => hexToTronAddress('aabb')).toThrow(TxCompilerError);
    expect(() => hexToTronAddress('00'.repeat(21))).toThrow(TxCompilerError);
  });

  it('rejects non-hex input', () => {
    expect(() => hexToTronAddress('zz'.repeat(20))).toThrow(TxCompilerError);
  });
});

describe('isValidTronAddress', () => {
  it('accepts valid hex and base58 forms', () => {
    expect(isValidTronAddress(KNOWN_HEX)).toBe(true);
    expect(isValidTronAddress('0x' + KNOWN_HEX)).toBe(true);
    expect(isValidTronAddress(KNOWN_T_ADDRESS)).toBe(true);
  });

  it('rejects invalid checksum and wrong network prefix', () => {
    const badChecksum = KNOWN_T_ADDRESS.slice(0, -1) + 'a';
    const badPrefix = base58CheckEncode(hexToBytes('42d8da6bf26964af9d7eed9e03e53415d37aa96045'));

    expect(isValidTronAddress(badChecksum)).toBe(false);
    expect(isValidTronAddress(badPrefix)).toBe(false);
  });

  it('rejects non Tron values', () => {
    expect(isValidTronAddress('')).toBe(false);
    expect(isValidTronAddress('T123')).toBe(false);
    expect(isValidTronAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(false);
  });
});
