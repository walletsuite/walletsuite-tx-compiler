import { sha256 } from '@noble/hashes/sha2.js';
import { TxCompilerError } from './errors.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TRON_ADDRESS_HEX_RE = /^(0x)?41[0-9a-fA-F]{40}$/;
const TRON_ADDRESS_BYTES = 21;
const BASE58CHECK_BYTES = 25;

export function tronAddressToBytes(address: string): Uint8Array {
  if (TRON_ADDRESS_HEX_RE.test(address)) {
    const hex = address.startsWith('0x') ? address.slice(2) : address;
    return hexStringToBytes(hex);
  }

  if (!address.startsWith('T')) {
    throw invalidTronAddress(address, `Invalid Tron address format: ${address}`);
  }

  return base58CheckDecode(address);
}

export function isValidTronAddress(address: string): boolean {
  try {
    tronAddressToBytes(address);
    return true;
  } catch (error) {
    if (error instanceof TxCompilerError && error.code === 'INVALID_ADDRESS') {
      return false;
    }

    throw error;
  }
}

function base58CheckDecode(encoded: string): Uint8Array {
  const raw = base58Decode(encoded);

  if (raw.length !== BASE58CHECK_BYTES) {
    throw invalidTronAddress(encoded, 'Base58check payload must be 25 bytes');
  }

  const payload = raw.slice(0, TRON_ADDRESS_BYTES);
  const checksum = raw.slice(TRON_ADDRESS_BYTES);
  const expected = sha256(sha256(payload)).slice(0, 4);

  for (let i = 0; i < expected.length; i++) {
    if (checksum[i] !== expected[i]) {
      throw invalidTronAddress(encoded, 'Invalid base58check checksum');
    }
  }

  if (payload[0] !== 0x41) {
    throw invalidTronAddress(encoded, 'Tron base58 payload must start with 0x41');
  }

  return payload;
}

function base58Decode(encoded: string): Uint8Array {
  let num = 0n;

  for (const char of encoded) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw invalidTronAddress(encoded, `Invalid base58 character: ${char}`);
    }

    num = num * 58n + BigInt(index);
  }

  let bytes: Uint8Array;
  if (num === 0n) {
    bytes = new Uint8Array(0);
  } else {
    const hex = num.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
    bytes = hexStringToBytes(paddedHex);
  }

  let leadingZeros = 0;
  for (const char of encoded) {
    if (char !== '1') break;
    leadingZeros++;
  }

  if (leadingZeros === 0) {
    return bytes;
  }

  const result = new Uint8Array(leadingZeros + bytes.length);
  result.set(bytes, leadingZeros);
  return result;
}

function hexStringToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function invalidTronAddress(address: string, message: string): TxCompilerError {
  return new TxCompilerError('INVALID_ADDRESS', message, { address });
}
