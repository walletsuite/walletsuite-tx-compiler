/**
 * Runtime validation of raw prepared transaction payloads.
 *
 * Accepts unknown input and returns a narrowed `PreparedTransaction`.
 */

import { getAddress } from 'ethers';
import { TxCompilerError } from './errors.js';
import { tronAddressToBytes } from './tron-address.js';
import type {
  Chain,
  FeeMode,
  FeeParams,
  PreparedTransaction,
  TronBlockHeader,
  TxType,
} from './types.js';

const VALID_CHAINS = new Set<string>(['ethereum', 'tron']);
const VALID_TX_TYPES = new Set<string>(['TRANSFER_NATIVE', 'TRANSFER_TOKEN']);
const VALID_FEE_MODES = new Set<string>(['EIP1559', 'LEGACY', 'TRON']);

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const NON_NEG_INT_RE = /^(0|[1-9]\d*)$/;

const ERC20_TRANSFER_SELECTOR = 'a9059cbb';
const ERC20_TRANSFER_CALLDATA_HEX_LEN = 136;
const ERC20_ADDRESS_PADDING = '0'.repeat(24);

export function validate(input: unknown): PreparedTransaction {
  if (input === null || typeof input !== 'object') {
    throw new TxCompilerError('INVALID_PAYLOAD', 'Expected a non-null object');
  }

  const obj = input as Record<string, unknown>;

  const chain = requireEnum<Chain>(obj, 'chain', VALID_CHAINS, 'UNSUPPORTED_CHAIN');
  const txType = requireEnum<TxType>(obj, 'txType', VALID_TX_TYPES, 'UNSUPPORTED_TX_TYPE');
  const from = requireString(obj, 'from');
  const to = requireString(obj, 'to');
  const valueWei = requireIntString(obj, 'valueWei');
  const data = optionalString(obj, 'data');
  const tokenContract = optionalString(obj, 'tokenContract');
  const chainId = optionalNumber(obj, 'chainId');
  const nonce = optionalIntString(obj, 'nonce');
  const fee = validateFee(obj.fee, chain);

  if (chain === 'ethereum') {
    validateEthereumPayload({
      txType,
      from,
      to,
      valueWei,
      data,
      tokenContract,
      chainId,
      nonce,
    });
  } else {
    validateTronPayload({
      txType,
      from,
      to,
      data,
      tokenContract,
      chainId,
      nonce,
    });
  }

  return { chain, chainId, from, to, valueWei, data, txType, tokenContract, nonce, fee };
}

function validateEthereumPayload(prepared: {
  readonly txType: TxType;
  readonly from: string;
  readonly to: string;
  readonly valueWei: string;
  readonly data: string | null;
  readonly tokenContract: string | null;
  readonly chainId: number | null;
  readonly nonce: string | null;
}): void {
  if (prepared.chainId == null || prepared.chainId < 1) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM chainId must be a positive integer', {
      chainId: prepared.chainId,
    });
  }

  if (prepared.nonce == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM transactions require nonce');
  }

  if (BigInt(prepared.nonce) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM nonce exceeds safe integer range (max 2^53 - 1)',
      { nonce: prepared.nonce },
    );
  }

  validateEvmAddress(prepared.from, 'from');
  validateEvmAddress(prepared.to, 'to');

  if (prepared.txType === 'TRANSFER_NATIVE') {
    if (prepared.tokenContract != null) {
      throw new TxCompilerError(
        'INVALID_PAYLOAD',
        'EVM TRANSFER_NATIVE must not include tokenContract',
      );
    }

    assertPreparedDataEmpty(prepared.data, 'EVM TRANSFER_NATIVE must not carry calldata');
    return;
  }

  if (prepared.tokenContract == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'TRANSFER_TOKEN requires tokenContract');
  }

  validateEvmAddress(prepared.tokenContract, 'tokenContract');
  validateEvmTokenTransfer(
    prepared.data,
    prepared.to,
    prepared.tokenContract,
    prepared.valueWei,
  );
}

function validateTronPayload(prepared: {
  readonly txType: TxType;
  readonly from: string;
  readonly to: string;
  readonly data: string | null;
  readonly tokenContract: string | null;
  readonly chainId: number | null;
  readonly nonce: string | null;
}): void {
  if (prepared.chainId != null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'Tron transactions must not include chainId', {
      chainId: prepared.chainId,
    });
  }

  if (prepared.nonce != null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'Tron transactions must not include nonce', {
      nonce: prepared.nonce,
    });
  }

  validateTronAddressFull(prepared.from, 'from');
  validateTronAddressFull(prepared.to, 'to');
  assertPreparedDataEmpty(prepared.data, 'Tron prepared payload must not include calldata');

  if (prepared.txType === 'TRANSFER_NATIVE') {
    if (prepared.tokenContract != null) {
      throw new TxCompilerError(
        'INVALID_PAYLOAD',
        'Tron TRANSFER_NATIVE must not include tokenContract',
      );
    }

    return;
  }

  if (prepared.tokenContract == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'TRANSFER_TOKEN requires tokenContract');
  }

  validateTronAddressFull(prepared.tokenContract, 'tokenContract');
}

function validateEvmTokenTransfer(
  data: string | null,
  to: string,
  tokenContract: string,
  valueWei: string,
): void {
  if (data == null || data === '' || data === '0x') {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM TRANSFER_TOKEN requires calldata');
  }

  const hex = data.startsWith('0x') ? data.slice(2) : data;

  if (!HEX_RE.test(hex)) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      'EVM TRANSFER_TOKEN calldata contains non-hex characters',
    );
  }

  if (hex.length !== ERC20_TRANSFER_CALLDATA_HEX_LEN) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `EVM TRANSFER_TOKEN calldata must be exactly 68 bytes (got ${String(hex.length / 2)})`,
      { expected: ERC20_TRANSFER_CALLDATA_HEX_LEN, length: hex.length },
    );
  }

  const selector = hex.slice(0, 8).toLowerCase();
  if (selector !== ERC20_TRANSFER_SELECTOR) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `Expected ERC-20 transfer selector ${ERC20_TRANSFER_SELECTOR}, got ${selector}`,
    );
  }

  const addressPadding = hex.slice(8, 32);
  if (addressPadding !== ERC20_ADDRESS_PADDING) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      'ERC-20 transfer address has non-zero upper bytes',
    );
  }

  if (to.toLowerCase() !== tokenContract.toLowerCase()) {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM TRANSFER_TOKEN: to must equal tokenContract',
      { to, tokenContract },
    );
  }

  if (valueWei !== '0') {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM TRANSFER_TOKEN: valueWei must be 0', {
      valueWei,
    });
  }
}

function validateFee(raw: unknown, chain: Chain): FeeParams {
  if (raw === null || typeof raw !== 'object') {
    throw new TxCompilerError('MISSING_FEE_PARAMS', 'Missing fee object');
  }

  const obj = raw as Record<string, unknown>;
  const mode = requireEnum<FeeMode>(obj, 'mode', VALID_FEE_MODES, 'UNSUPPORTED_FEE_MODE');

  if (chain === 'ethereum' && mode === 'TRON') {
    throw new TxCompilerError('UNSUPPORTED_FEE_MODE', 'TRON fee mode invalid for ethereum chain');
  }

  if (chain === 'tron' && mode !== 'TRON') {
    throw new TxCompilerError('UNSUPPORTED_FEE_MODE', `${mode} fee mode invalid for tron chain`);
  }

  const gasLimit = optionalIntString(obj, 'gasLimit');
  const baseFeePerGas = optionalIntString(obj, 'baseFeePerGas');
  const maxPriorityFeePerGas = optionalIntString(obj, 'maxPriorityFeePerGas');
  const maxFeePerGas = optionalIntString(obj, 'maxFeePerGas');
  const gasPrice = optionalIntString(obj, 'gasPrice');
  const el = optionalIntString(obj, 'el');
  const rp = optionalBlockHeader(obj.rp);

  if (mode === 'EIP1559') {
    if (gasLimit == null) {
      throw new TxCompilerError('MISSING_FEE_PARAMS', 'EIP-1559 requires gasLimit');
    }

    if (maxFeePerGas == null || maxPriorityFeePerGas == null) {
      throw new TxCompilerError(
        'MISSING_FEE_PARAMS',
        'EIP-1559 requires maxFeePerGas and maxPriorityFeePerGas',
      );
    }
  }

  if (mode === 'LEGACY') {
    if (gasLimit == null) {
      throw new TxCompilerError('MISSING_FEE_PARAMS', 'LEGACY requires gasLimit');
    }

    if (gasPrice == null && maxFeePerGas == null) {
      throw new TxCompilerError('MISSING_FEE_PARAMS', 'LEGACY requires gasPrice or maxFeePerGas');
    }
  }

  if (mode === 'TRON' && rp == null) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'TRON fee mode requires block header (rp)');
  }

  return {
    mode,
    gasLimit,
    baseFeePerGas,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasPrice,
    el,
    rp,
  };
}

function optionalBlockHeader(raw: unknown): TronBlockHeader | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw !== 'object') {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block header must be an object');
  }

  const obj = raw as Record<string, unknown>;
  const h = requireString(obj, 'h');
  const n = requirePositiveInt(obj, 'n');
  const t = requirePositiveInt(obj, 't');
  const v = requireNonNegativeInt(obj, 'v');

  if (h.length < 32) {
    throw new TxCompilerError(
      'INVALID_BLOCK_HEADER',
      'Block ID (h) must be at least 32 hex characters',
    );
  }

  if (!HEX_RE.test(h)) {
    throw new TxCompilerError(
      'INVALID_BLOCK_HEADER',
      'Block ID (h) must contain only hex characters',
    );
  }

  if (h.length % 2 !== 0) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block ID (h) must have even-length hex');
  }

  const p = optionalBlockHeaderString(obj, 'p') ?? undefined;
  const r = optionalBlockHeaderString(obj, 'r') ?? undefined;
  const w = optionalBlockHeaderString(obj, 'w') ?? undefined;

  if (w != null) {
    validateTronAddressFull(w, 'w');
  }

  return { h, n, t, p, r, w, v };
}

function validateEvmAddress(address: string, field: string): void {
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid EVM address in ${field}: ${address}`, {
      address,
      field,
    });
  }

  try {
    getAddress(address);
  } catch {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid EVM address in ${field}: ${address}`, {
      address,
      field,
    });
  }
}

function validateTronAddressFull(address: string, field: string): void {
  try {
    tronAddressToBytes(address);
  } catch (error) {
    if (error instanceof TxCompilerError) {
      throw new TxCompilerError(
        'INVALID_ADDRESS',
        `Invalid Tron address in ${field}: ${address}`,
        {
          address,
          field,
        },
      );
    }

    throw error;
  }
}

function assertPreparedDataEmpty(data: string | null, message: string): void {
  if (data == null || data === '' || data === '0x') {
    return;
  }

  throw new TxCompilerError('INVALID_PAYLOAD', message, {
    dataLength: data.length,
  });
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value === '') {
    throw new TxCompilerError('INVALID_PAYLOAD', `Missing or empty string field: ${field}`);
  }
  return value;
}

function optionalString(obj: Record<string, unknown>, field: string): string | null {
  const value = obj[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TxCompilerError('INVALID_PAYLOAD', `Invalid optional string field: ${field}`, {
      field,
      value,
    });
  }
  return value;
}

function optionalBlockHeaderString(
  obj: Record<string, unknown>,
  field: string,
): string | null {
  const value = obj[field];
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', `Invalid block header field: ${field}`, {
      field,
      value,
    });
  }

  return value;
}

function optionalNumber(obj: Record<string, unknown>, field: string): number | null {
  const value = obj[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TxCompilerError('INVALID_PAYLOAD', `Invalid optional number field: ${field}`, {
      field,
      value,
    });
  }
  return value;
}

function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  valid: Set<string>,
  errorCode: TxCompilerError['code'],
): T {
  const value = obj[field];
  if (typeof value !== 'string' || !valid.has(value)) {
    throw new TxCompilerError(errorCode, `Invalid ${field}: ${String(value)}`);
  }
  return value as T;
}

function requireIntString(obj: Record<string, unknown>, field: string): string {
  const raw = obj[field];
  const value = coerceToString(raw);
  if (value === null || !NON_NEG_INT_RE.test(value)) {
    throw new TxCompilerError('INVALID_AMOUNT', `${field} must be a non-negative integer`, {
      field,
      value: raw,
    });
  }
  return value;
}

function optionalIntString(obj: Record<string, unknown>, field: string): string | null {
  const raw = obj[field];
  if (raw === null || raw === undefined) return null;
  const value = coerceToString(raw);
  if (value === null || !NON_NEG_INT_RE.test(value)) {
    throw new TxCompilerError('INVALID_AMOUNT', `${field} must be a non-negative integer`, {
      field,
      value: raw,
    });
  }
  return value;
}

function requirePositiveInt(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', `Block header field ${field} must be a positive integer`, {
      field,
      value,
    });
  }
  return value;
}

function requireNonNegativeInt(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', `Block header field ${field} must be a non-negative integer`, {
      field,
      value,
    });
  }
  return value;
}

function coerceToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return null;
}
