/**
 * Runtime validation for prepared Ethereum transaction payloads.
 *
 * This stage validates the current supported scope only:
 * Ethereum native transfers with EIP-1559 or legacy fees.
 */

import { getAddress } from 'ethers';
import { TxCompilerError } from './errors.js';
import type { Chain, FeeMode, FeeParams, PreparedTransaction, TxType } from './types.js';

const VALID_CHAINS = new Set<string>(['ethereum']);
const VALID_TX_TYPES = new Set<string>(['TRANSFER_NATIVE']);
const VALID_FEE_MODES = new Set<string>(['EIP1559', 'LEGACY']);

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NON_NEG_INT_RE = /^(0|[1-9]\d*)$/;

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
  const fee = validateFee(obj.fee);

  if (chainId == null || chainId < 1 || chainId % 1 !== 0) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM chainId must be a positive integer', {
      chainId,
    });
  }

  if (nonce == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM transactions require nonce');
  }

  if (BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM nonce exceeds safe integer range (max 2^53 - 1)',
      { nonce },
    );
  }

  validateEvmAddress(from, 'from');
  validateEvmAddress(to, 'to');

  if (tokenContract != null) {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM TRANSFER_NATIVE must not include tokenContract',
    );
  }

  if (data != null && data !== '' && data !== '0x') {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM TRANSFER_NATIVE must not carry calldata', {
      dataLength: data.length,
    });
  }

  return { chain, chainId, from, to, valueWei, data, txType, tokenContract, nonce, fee };
}

function validateFee(raw: unknown): FeeParams {
  if (raw === null || typeof raw !== 'object') {
    throw new TxCompilerError('MISSING_FEE_PARAMS', 'Missing fee object');
  }

  const obj = raw as Record<string, unknown>;
  const mode = requireEnum<FeeMode>(obj, 'mode', VALID_FEE_MODES, 'UNSUPPORTED_FEE_MODE');

  const gasLimit = optionalIntString(obj, 'gasLimit');
  const baseFeePerGas = optionalIntString(obj, 'baseFeePerGas');
  const maxPriorityFeePerGas = optionalIntString(obj, 'maxPriorityFeePerGas');
  const maxFeePerGas = optionalIntString(obj, 'maxFeePerGas');
  const gasPrice = optionalIntString(obj, 'gasPrice');

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

  return {
    mode,
    gasLimit,
    baseFeePerGas,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasPrice,
  };
}

function validateEvmAddress(address: string, field: string): void {
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid EVM address in ${field}: ${address}`, {
      field,
      address,
    });
  }

  try {
    getAddress(address);
  } catch {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid EVM address in ${field}: ${address}`, {
      field,
      address,
    });
  }
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

function optionalNumber(obj: Record<string, unknown>, field: string): number | null {
  const value = obj[field];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return null;
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

function coerceToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return null;
}
