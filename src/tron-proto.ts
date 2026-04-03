import { TxCompilerError } from './errors.js';

const WIRE_VARINT = 0;
const WIRE_LEN = 2;

const TRON_ADDRESS_LENGTH = 21;
const REF_BLOCK_BYTES_LENGTH = 2;
const REF_BLOCK_HASH_LENGTH = 8;
const TYPE_URL_ENCODER = new TextEncoder();

/**
 * Minimal protobuf encoding for Tron transactions.
 *
 * Only the message shapes needed by native transfers and TRC-20 calls are
 * implemented here. Keeping this local avoids a full protobuf runtime.
 */

/** Encode a non-negative integer as a protobuf unsigned varint */
export function encodeVarint(value: bigint): Uint8Array {
  assertNonNegativeBigInt('value', value, 'INVALID_PAYLOAD');

  if (value === 0n) {
    return new Uint8Array([0]);
  }

  const bytes: number[] = [];
  let remaining = value;

  while (remaining > 0x7fn) {
    bytes.push(Number(remaining & 0x7fn) | 0x80);
    remaining >>= 7n;
  }

  bytes.push(Number(remaining & 0x7fn));
  return new Uint8Array(bytes);
}

/** Concatenate byte arrays */
export function concat(...arrays: readonly Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

/** Encode a Tron `TransferContract` (contract type `1`) */
export function encodeTransferContract(
  owner: Uint8Array,
  to: Uint8Array,
  amount: bigint,
): Uint8Array {
  assertByteLength('owner', owner, TRON_ADDRESS_LENGTH, 'INVALID_ADDRESS');
  assertByteLength('to', to, TRON_ADDRESS_LENGTH, 'INVALID_ADDRESS');
  assertNonNegativeBigInt('amount', amount, 'INVALID_AMOUNT');

  const inner = concat(bytesField(1, owner), bytesField(2, to), varintField(3, amount));
  return wrapInContract(1, 'protocol.TransferContract', inner);
}

/** Encode a Tron `TriggerSmartContract` (contract type `31`) */
export function encodeTriggerSmartContract(
  owner: Uint8Array,
  contractAddress: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  assertByteLength('owner', owner, TRON_ADDRESS_LENGTH, 'INVALID_ADDRESS');
  assertByteLength('contractAddress', contractAddress, TRON_ADDRESS_LENGTH, 'INVALID_ADDRESS');
  assertNonEmptyBytes('data', data, 'INVALID_CALLDATA');

  const inner = concat(bytesField(1, owner), bytesField(2, contractAddress), bytesField(4, data));

  return wrapInContract(31, 'protocol.TriggerSmartContract', inner);
}

export interface RawDataParams {
  readonly refBlockBytes: Uint8Array;
  readonly refBlockHash: Uint8Array;
  readonly expiration: number;
  readonly timestamp: number;
  readonly contract: Uint8Array;
  readonly feeLimit?: bigint;
}

/** Encode the `Transaction.raw_data` protobuf message */
export function encodeRawData(params: RawDataParams): Uint8Array {
  assertByteLength(
    'refBlockBytes',
    params.refBlockBytes,
    REF_BLOCK_BYTES_LENGTH,
    'INVALID_BLOCK_HEADER',
  );
  assertByteLength(
    'refBlockHash',
    params.refBlockHash,
    REF_BLOCK_HASH_LENGTH,
    'INVALID_BLOCK_HEADER',
  );
  assertNonNegativeSafeInteger('expiration', params.expiration, 'INVALID_PAYLOAD');
  assertNonNegativeSafeInteger('timestamp', params.timestamp, 'INVALID_PAYLOAD');
  assertNonEmptyBytes('contract', params.contract, 'INVALID_PAYLOAD');

  const fields: Uint8Array[] = [
    bytesField(1, params.refBlockBytes),
    bytesField(4, params.refBlockHash),
    varintField(8, BigInt(params.expiration)),
    bytesField(11, params.contract),
    varintField(14, BigInt(params.timestamp)),
  ];

  if (params.feeLimit !== undefined) {
    assertNonNegativeBigInt('feeLimit', params.feeLimit, 'INVALID_AMOUNT');
    if (params.feeLimit > 0n) {
      fields.push(varintField(18, params.feeLimit));
    }
  }

  return concat(...fields);
}

function wrapInContract(contractType: number, typeUrl: string, value: Uint8Array): Uint8Array {
  const fullTypeUrl = `type.googleapis.com/${typeUrl}`;
  const any = concat(bytesField(1, TYPE_URL_ENCODER.encode(fullTypeUrl)), bytesField(2, value));
  return concat(varintField(1, BigInt(contractType)), bytesField(2, any));
}

function varintField(fieldNumber: number, value: bigint): Uint8Array {
  const tag = encodeVarint(BigInt((fieldNumber << 3) | WIRE_VARINT));
  return concat(tag, encodeVarint(value));
}

function bytesField(fieldNumber: number, data: Uint8Array): Uint8Array {
  const tag = encodeVarint(BigInt((fieldNumber << 3) | WIRE_LEN));
  const length = encodeVarint(BigInt(data.length));
  return concat(tag, length, data);
}

function assertByteLength(
  field: string,
  value: Uint8Array,
  expectedLength: number,
  code: 'INVALID_ADDRESS' | 'INVALID_BLOCK_HEADER',
): void {
  if (value.length !== expectedLength) {
    throw new TxCompilerError(code, `${field} must be ${expectedLength} bytes`, {
      actualLength: value.length,
      expectedLength,
      field,
    });
  }
}

function assertNonEmptyBytes(
  field: string,
  value: Uint8Array,
  code: 'INVALID_CALLDATA' | 'INVALID_PAYLOAD',
): void {
  if (value.length === 0) {
    throw new TxCompilerError(code, `${field} must not be empty`, { field });
  }
}

function assertNonNegativeBigInt(
  field: string,
  value: bigint,
  code: 'INVALID_AMOUNT' | 'INVALID_PAYLOAD',
): void {
  if (value < 0n) {
    throw new TxCompilerError(code, `${field} must be a non-negative integer`, {
      field,
      value: value.toString(),
    });
  }
}

function assertNonNegativeSafeInteger(field: string, value: number, code: 'INVALID_PAYLOAD'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TxCompilerError(code, `${field} must be a non-negative safe integer`, {
      field,
      value,
    });
  }
}
