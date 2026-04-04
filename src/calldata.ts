/**
 * ABI calldata decoding for EVM and Tron smart contract interactions.
 *
 * Provides a generic decoder for known function selectors and a targeted
 * helper for ERC-20 / TRC-20 transfer calldata.
 */

import { getAddress } from 'ethers';
import { TxCompilerError } from './errors.js';
import { hexToTronAddress } from './tron-address.js';
import type {
  AbiParamType,
  Chain,
  DecodedCalldata,
  DecodedParam,
  DecodedTokenTransfer,
} from './types.js';

const HEX_RE = /^[0-9a-fA-F]+$/;
const SELECTOR_HEX_LEN = 8;
const WORD_HEX_LEN = 64;
const ADDRESS_PADDING = '0'.repeat(24);

// ---------------------------------------------------------------------------
// Known function selector registry
// ---------------------------------------------------------------------------

interface ParamDef {
  readonly name: string;
  readonly type: AbiParamType;
}

interface FunctionDef {
  readonly name: string;
  readonly params: readonly ParamDef[];
}

const KNOWN_FUNCTIONS: ReadonlyMap<string, FunctionDef> = new Map([
  [
    'a9059cbb',
    {
      name: 'transfer',
      params: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    },
  ],
  [
    '095ea7b3',
    {
      name: 'approve',
      params: [
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    },
  ],
  [
    '23b872dd',
    {
      name: 'transferFrom',
      params: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    },
  ],
]);

// ---------------------------------------------------------------------------
// Generic calldata decoder
// ---------------------------------------------------------------------------

/**
 * Decode ABI-encoded calldata into its function selector and parameters.
 *
 * For recognized selectors the parameters are decoded by name and type.
 * Unrecognized selectors return an empty params array — the raw hex can
 * still be inspected via the selector field.
 */
export function decodeCalldata(data: string): DecodedCalldata {
  const hex = stripPrefix(data);
  validateHex(hex);

  if (hex.length < SELECTOR_HEX_LEN) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `Calldata must be at least 4 bytes (got ${String(hex.length / 2)})`,
    );
  }

  const selector = hex.slice(0, SELECTOR_HEX_LEN).toLowerCase();
  const paramsHex = hex.slice(SELECTOR_HEX_LEN);
  const fn = KNOWN_FUNCTIONS.get(selector);

  if (fn == null) {
    return { selector, name: null, params: [] };
  }

  const expectedLen = fn.params.length * WORD_HEX_LEN;
  if (paramsHex.length !== expectedLen) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `${fn.name} expects ${String(fn.params.length * 32)} bytes of parameters (got ${String(paramsHex.length / 2)})`,
      { selector, expected: expectedLen, actual: paramsHex.length },
    );
  }

  const params = fn.params.map((def, i) =>
    decodeWord(paramsHex.slice(i * WORD_HEX_LEN, (i + 1) * WORD_HEX_LEN), def),
  );

  return { selector, name: fn.name, params };
}

// ---------------------------------------------------------------------------
// ERC-20 / TRC-20 transfer helper
// ---------------------------------------------------------------------------

const TRANSFER_SELECTOR = 'a9059cbb';

/**
 * Decode an ERC-20 / TRC-20 `transfer(address,uint256)` calldata and
 * return the recipient and amount in chain-native formats.
 *
 * - Ethereum: recipient is a checksummed 0x address
 * - Tron: recipient is a base58check T-address
 */
export function decodeTokenTransfer(data: string, chain: Chain): DecodedTokenTransfer {
  const decoded = decodeCalldata(data);

  if (decoded.selector !== TRANSFER_SELECTOR) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `Expected transfer selector ${TRANSFER_SELECTOR}, got ${decoded.selector}`,
    );
  }

  const recipientParam = decoded.params.find((p) => p.name === 'to');
  const amountParam = decoded.params.find((p) => p.name === 'value');

  if (recipientParam == null || amountParam == null) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Decoded transfer is missing expected params');
  }

  return {
    recipient: formatAddress(recipientParam.value, chain),
    amount: amountParam.value,
  };
}

// ---------------------------------------------------------------------------
// ABI word decoding
// ---------------------------------------------------------------------------

function decodeWord(wordHex: string, def: ParamDef): DecodedParam {
  switch (def.type) {
    case 'address':
      return { name: def.name, type: def.type, value: decodeAddress(wordHex) };
    case 'uint256':
      return { name: def.name, type: def.type, value: decodeUint256(wordHex) };
    case 'bool':
      return { name: def.name, type: def.type, value: decodeBool(wordHex) };
    case 'bytes32':
      return { name: def.name, type: def.type, value: '0x' + wordHex.toLowerCase() };
  }
}

function decodeAddress(wordHex: string): string {
  const padding = wordHex.slice(0, 24);
  if (padding !== ADDRESS_PADDING) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Address parameter has non-zero upper bytes');
  }

  return '0x' + wordHex.slice(24);
}

function decodeUint256(wordHex: string): string {
  return BigInt('0x' + wordHex).toString();
}

function decodeBool(wordHex: string): string {
  const value = BigInt('0x' + wordHex);
  if (value !== 0n && value !== 1n) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Bool parameter must be 0 or 1', {
      value: value.toString(),
    });
  }

  return value === 1n ? 'true' : 'false';
}

// ---------------------------------------------------------------------------
// Address formatting
// ---------------------------------------------------------------------------

function formatAddress(rawHex: string, chain: Chain): string {
  const hex20 = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex;

  switch (chain) {
    case 'ethereum':
      return getAddress('0x' + hex20);
    case 'tron':
      return hexToTronAddress(hex20);
    default:
      throw new TxCompilerError(
        'UNSUPPORTED_CHAIN',
        `Address formatting not supported for chain: ${chain as string}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Hex utilities
// ---------------------------------------------------------------------------

function stripPrefix(data: string): string {
  return data.startsWith('0x') ? data.slice(2) : data;
}

function validateHex(hex: string): void {
  if (hex.length === 0) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Calldata must not be empty');
  }

  if (hex.length % 2 !== 0) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Calldata has odd number of hex characters');
  }

  if (!HEX_RE.test(hex)) {
    throw new TxCompilerError('INVALID_CALLDATA', 'Calldata contains non-hex characters');
  }
}
