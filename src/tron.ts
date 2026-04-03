/**
 * Tron transaction compilation.
 *
 * Converts a prepared Tron transaction into unsigned protobuf `raw_data`
 * bytes and the SHA-256 hash that signers should sign.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { TxCompilerError } from './errors.js';
import { tronAddressToBytes } from './tron-address.js';
import {
  concat,
  encodeRawData,
  encodeTransferContract,
  encodeTriggerSmartContract,
} from './tron-proto.js';
import type {
  CompilationResult,
  CompileOptions,
  PreparedTransaction,
  TronBlockHeader,
} from './types.js';

const EXPIRATION_WINDOW_MS = 10 * 60 * 60 * 1000;
const HEX_RE = /^[0-9a-fA-F]+$/;
const NON_NEG_INT_RE = /^(0|[1-9]\d*)$/;
const MAX_UINT256 = (1n << 256n) - 1n;

export function compileTron(
  prepared: PreparedTransaction,
  options?: CompileOptions,
): CompilationResult {
  if (prepared.chain !== 'tron') {
    throw new TxCompilerError('UNSUPPORTED_CHAIN', `${prepared.chain} compilation not supported by Tron compiler`);
  }

  if (prepared.fee.mode !== 'TRON') {
    throw new TxCompilerError(
      'UNSUPPORTED_FEE_MODE',
      `${prepared.fee.mode} fee mode invalid for tron chain`,
    );
  }

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

  const header = requireTronBlockHeader(prepared.fee.rp);

  try {
    const timestamp = requireTimestamp(options?.now ?? Date.now(), 'now');
    const expiration = requireExpiration(header.t);
    const refBlockBytes = buildRefBlockBytes(header.n);
    const refBlockHash = buildRefBlockHash(header.h);

    let contractType: number;
    let contract: Uint8Array;

    if (prepared.txType === 'TRANSFER_NATIVE') {
      assertPreparedDataEmpty(prepared.data);
      if (prepared.tokenContract != null) {
        throw new TxCompilerError(
          'INVALID_PAYLOAD',
          'Tron TRANSFER_NATIVE must not include tokenContract',
        );
      }

      contractType = 1;
      contract = encodeTransferContract(
        tronAddressToBytes(prepared.from),
        tronAddressToBytes(prepared.to),
        parseUnsignedBigInt(prepared.valueWei, 'valueWei'),
      );
    } else if (prepared.txType === 'TRANSFER_TOKEN') {
      assertPreparedDataEmpty(prepared.data);
      if (prepared.tokenContract == null) {
        throw new TxCompilerError('INVALID_PAYLOAD', 'Token transfer requires tokenContract');
      }

      contractType = 31;
      contract = encodeTriggerSmartContract(
        tronAddressToBytes(prepared.from),
        tronAddressToBytes(prepared.tokenContract),
        buildTrc20TransferData(prepared.to, prepared.valueWei),
      );
    } else {
      throw new TxCompilerError(
        'UNSUPPORTED_TX_TYPE',
        `${prepared.txType} compilation not supported for tron chain`,
      );
    }

    const feeLimit =
      prepared.fee.el == null ? undefined : parseUnsignedBigInt(prepared.fee.el, 'fee.el');

    const rawData = encodeRawData({
      refBlockBytes,
      refBlockHash,
      expiration,
      timestamp,
      contract,
      feeLimit,
    });

    return {
      chain: 'tron',
      unsignedTx: '0x' + bytesToHex(rawData),
      txHash: '0x' + bytesToHex(sha256(rawData)),
      metadata: {
        txType: prepared.txType,
        feeMode: 'TRON',
        tronContractType: contractType,
        expiration,
      },
    };
  } catch (error) {
    if (error instanceof TxCompilerError) {
      throw error;
    }

    throw new TxCompilerError('COMPILATION_FAILED', `Tron compilation failed: ${String(error)}`, {
      cause: String(error),
    });
  }
}

function buildTrc20TransferData(recipient: string, amount: string): Uint8Array {
  const selector = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb]);
  const recipientBytes = tronAddressToBytes(recipient).slice(1);
  const encodedRecipient = new Uint8Array(32);
  encodedRecipient.set(recipientBytes, 12);

  return concat(selector, encodedRecipient, bigIntToBytes32(parseUnsignedBigInt(amount, 'valueWei')));
}

function bigIntToBytes32(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_UINT256) {
    throw new TxCompilerError('INVALID_AMOUNT', 'Amount exceeds uint256 range', {
      value: value.toString(),
    });
  }

  const result = new Uint8Array(32);
  let remaining = value;

  for (let index = 31; index >= 0; index--) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return result;
}

function requireTronBlockHeader(header: TronBlockHeader | null | undefined): TronBlockHeader {
  if (header == null) {
    throw new TxCompilerError(
      'INVALID_BLOCK_HEADER',
      'Tron transactions require block header (fee.rp)',
    );
  }

  if (
    typeof header.h !== 'string' ||
    header.h.length < 32 ||
    header.h.length % 2 !== 0 ||
    !HEX_RE.test(header.h)
  ) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block ID (h) must be even-length hex with at least 32 characters', {
      h: header.h,
    });
  }

  if (!Number.isSafeInteger(header.n) || header.n < 1) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block number (n) must be a positive integer', {
      n: header.n,
    });
  }

  if (!Number.isSafeInteger(header.t) || header.t < 1) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block timestamp (t) must be a positive integer', {
      t: header.t,
    });
  }

  if (!Number.isSafeInteger(header.v) || header.v < 0) {
    throw new TxCompilerError('INVALID_BLOCK_HEADER', 'Block version (v) must be a non-negative integer', {
      v: header.v,
    });
  }

  return header;
}

function requireTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TxCompilerError('INVALID_PAYLOAD', `${field} must be a non-negative safe integer`, {
      field,
      value,
    });
  }

  return value;
}

function requireExpiration(blockTimestamp: number): number {
  const expiration = blockTimestamp + EXPIRATION_WINDOW_MS;

  if (!Number.isSafeInteger(expiration)) {
    throw new TxCompilerError(
      'INVALID_BLOCK_HEADER',
      'Block timestamp produces an invalid expiration value',
      { blockTimestamp },
    );
  }

  return expiration;
}

function buildRefBlockBytes(blockNumber: number): Uint8Array {
  return hexToBytes(blockNumber.toString(16).padStart(16, '0').slice(-4));
}

function buildRefBlockHash(blockId: string): Uint8Array {
  return hexToBytes(blockId.slice(16, 32));
}

function assertPreparedDataEmpty(data: string | null): void {
  if (data == null || data === '' || data === '0x') {
    return;
  }

  throw new TxCompilerError('INVALID_PAYLOAD', 'Tron prepared payload must not include calldata', {
    dataLength: data.length,
  });
}

function parseUnsignedBigInt(value: string, field: string): bigint {
  if (!NON_NEG_INT_RE.test(value)) {
    throw new TxCompilerError('INVALID_AMOUNT', `${field} must be a non-negative integer`, {
      field,
      value,
    });
  }

  return BigInt(value);
}
