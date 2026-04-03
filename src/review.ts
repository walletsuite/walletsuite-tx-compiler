import { getAddress } from 'ethers';
import { TxCompilerError } from './errors.js';
import { tronAddressToBytes } from './tron-address.js';
import type {
  FeeParams,
  FeeReview,
  PreparedTransaction,
  TransactionReview,
  TronBlockHeader,
} from './types.js';

const ERC20_TRANSFER_SELECTOR = 'a9059cbb';
const ERC20_TRANSFER_CALLDATA_HEX_LEN = 136;
const ERC20_ADDRESS_PADDING = '0'.repeat(24);
const HEX_RE = /^[0-9a-fA-F]+$/;
const NON_NEG_INT_RE = /^(0|[1-9]\d*)$/;

/**
 * Produce a human-reviewable summary of a prepared transaction.
 */
export function review(prepared: PreparedTransaction): TransactionReview {
  switch (prepared.chain) {
    case 'ethereum':
      return reviewEvm(prepared);
    case 'tron':
      return reviewTron(prepared);
    default:
      throw new TxCompilerError('UNSUPPORTED_CHAIN', `${prepared.chain} review not supported yet`);
  }
}

function reviewEvm(prepared: PreparedTransaction): TransactionReview {
  const { chain, txType, from, to, valueWei, nonce, chainId, fee } = prepared;

  validateEvmAddress(from, 'from');

  const normalizedChainId = requirePositiveChainId(chainId);
  const normalizedNonce = requireNonce(nonce);

  let recipient: string;
  let amount: string;
  let tokenContract: string | null;

  if (txType === 'TRANSFER_NATIVE') {
    validateEvmAddress(to, 'to');
    tokenContract = resolveTokenContract(prepared);
    assertNativeCalldata(prepared.data);
    recipient = to;
    amount = requireUnsignedDecimal(valueWei, 'valueWei');
  } else if (txType === 'TRANSFER_TOKEN') {
    tokenContract = resolveTokenContract(prepared);
    if (prepared.data == null) {
      throw new TxCompilerError('INVALID_CALLDATA', 'EVM token transfer missing calldata (data)');
    }

    assertTokenNativeValue(valueWei);
    const decoded = decodeErc20TransferData(prepared.data);
    validateEvmAddress(decoded.recipient, 'recipient');
    recipient = decoded.recipient;
    amount = decoded.amount;
  } else {
    throw new TxCompilerError('UNSUPPORTED_TX_TYPE', `${txType} review not supported yet`);
  }

  return {
    chain,
    txType,
    from,
    recipient,
    amount,
    tokenContract,
    nonce: normalizedNonce,
    chainId: normalizedChainId,
    fee: buildEvmFeeReview(fee),
  };
}

function reviewTron(prepared: PreparedTransaction): TransactionReview {
  const { txType, from, to, valueWei, data, tokenContract, nonce, chainId, fee } = prepared;

  validateTronAddress(from, 'from');
  validateTronAddress(to, 'to');

  if (chainId != null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'Tron transactions must not include chainId', {
      chainId,
    });
  }

  if (nonce != null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'Tron transactions must not include nonce', {
      nonce,
    });
  }

  assertTronPreparedData(data);
  const feeReview = buildTronFeeReview(fee);

  if (txType === 'TRANSFER_NATIVE') {
    if (tokenContract != null) {
      throw new TxCompilerError(
        'INVALID_PAYLOAD',
        'Tron TRANSFER_NATIVE must not include tokenContract',
      );
    }

    return {
      chain: 'tron',
      txType,
      from,
      recipient: to,
      amount: requireUnsignedDecimal(valueWei, 'valueWei'),
      tokenContract: null,
      nonce: null,
      chainId: null,
      fee: feeReview,
    };
  }

  if (txType !== 'TRANSFER_TOKEN') {
    throw new TxCompilerError('UNSUPPORTED_TX_TYPE', `${txType} review not supported yet`);
  }

  if (tokenContract == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'TRANSFER_TOKEN requires tokenContract');
  }

  validateTronAddress(tokenContract, 'tokenContract');

  return {
    chain: 'tron',
    txType,
    from,
    recipient: to,
    amount: requireUnsignedDecimal(valueWei, 'valueWei'),
    tokenContract,
    nonce: null,
    chainId: null,
    fee: feeReview,
  };
}

/**
 * Decode the recipient and amount from ERC-20 transfer calldata.
 */
function decodeErc20TransferData(data: string): { recipient: string; amount: string } {
  const hex = data.startsWith('0x') ? data.slice(2) : data;

  if (!HEX_RE.test(hex)) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      'ERC-20 transfer calldata contains non-hex characters',
    );
  }

  if (hex.length !== ERC20_TRANSFER_CALLDATA_HEX_LEN) {
    throw new TxCompilerError(
      'INVALID_CALLDATA',
      `ERC-20 transfer calldata must be exactly 68 bytes (got ${String(hex.length / 2)})`,
      { length: hex.length, expected: ERC20_TRANSFER_CALLDATA_HEX_LEN },
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

  const recipient = '0x' + hex.slice(32, 72);
  const amountHex = hex.slice(72, 136);

  return {
    recipient,
    amount: BigInt('0x' + amountHex).toString(),
  };
}

/**
 * Resolve the token contract that will actually be executed on chain.
 */
function resolveTokenContract(prepared: PreparedTransaction): string | null {
  if (prepared.txType !== 'TRANSFER_TOKEN') {
    if (prepared.tokenContract != null) {
      throw new TxCompilerError(
        'INVALID_PAYLOAD',
        'EVM TRANSFER_NATIVE must not include tokenContract',
      );
    }

    return null;
  }

  validateEvmAddress(prepared.to, 'to');

  if (prepared.tokenContract == null) {
    return prepared.to;
  }

  validateEvmAddress(prepared.tokenContract, 'tokenContract');

  if (prepared.tokenContract.toLowerCase() !== prepared.to.toLowerCase()) {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM token transfer tokenContract must match the transaction target',
      {
        to: prepared.to,
        tokenContract: prepared.tokenContract,
      },
    );
  }

  return prepared.to;
}

/**
 * Summarize fee fields into confirmation friendly review values.
 */
function buildEvmFeeReview(fee: FeeParams): FeeReview {
  if (fee.mode === 'EIP1559') {
    const gasLimit = requireFeeField(fee.gasLimit, 'gasLimit');
    const maxFeePerGas = requireFeeField(fee.maxFeePerGas, 'maxFeePerGas');
    const maxPriorityFeePerGas = requireFeeField(
      fee.maxPriorityFeePerGas,
      'maxPriorityFeePerGas',
    );
    const baseFeePerGas = optionalUnsignedDecimal(fee.baseFeePerGas, 'baseFeePerGas');

    return {
      mode: fee.mode,
      estimatedMaxCost: (BigInt(gasLimit) * BigInt(maxFeePerGas)).toString(),
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      baseFeePerGas,
    };
  }

  if (fee.mode === 'LEGACY') {
    const gasLimit = requireFeeField(fee.gasLimit, 'gasLimit');
    const gasPrice = resolveLegacyGasPrice(fee);

    return {
      mode: fee.mode,
      estimatedMaxCost: (BigInt(gasLimit) * BigInt(gasPrice)).toString(),
      gasLimit,
      gasPrice,
    };
  }

  throw new TxCompilerError(
    'UNSUPPORTED_FEE_MODE',
    `${fee.mode} fee review invalid for ethereum chain`,
  );
}

function buildTronFeeReview(fee: FeeParams): FeeReview {
  if (fee.mode !== 'TRON') {
    throw new TxCompilerError('UNSUPPORTED_FEE_MODE', `${fee.mode} fee review invalid for tron chain`);
  }

  requireTronBlockHeader(fee.rp);
  const tronFeeLimit = optionalUnsignedDecimal(fee.el, 'el');

  return {
    mode: fee.mode,
    estimatedMaxCost: tronFeeLimit ?? null,
    tronFeeLimit,
  };
}

function validateEvmAddress(address: string, field: string): void {
  try {
    getAddress(address);
  } catch {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid EVM address in ${field}: ${address}`, {
      field,
      address,
    });
  }
}

function validateTronAddress(address: string, field: string): void {
  try {
    tronAddressToBytes(address);
  } catch {
    throw new TxCompilerError('INVALID_ADDRESS', `Invalid Tron address in ${field}: ${address}`, {
      field,
      address,
    });
  }
}

function requirePositiveChainId(chainId: number | null): number {
  if (chainId == null || !Number.isSafeInteger(chainId) || chainId < 1) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM chainId must be a positive integer', {
      chainId,
    });
  }

  return chainId;
}

function requireNonce(nonce: string | null): string {
  if (nonce == null) {
    throw new TxCompilerError('INVALID_PAYLOAD', 'EVM transactions require nonce');
  }

  return requireUnsignedDecimal(nonce, 'nonce');
}

function requireUnsignedDecimal(value: string, field: string): string {
  if (!NON_NEG_INT_RE.test(value)) {
    throw new TxCompilerError('INVALID_AMOUNT', `${field} must be a non-negative integer`, {
      field,
      value,
    });
  }

  return value;
}

function optionalUnsignedDecimal(
  value: string | null | undefined,
  field: string,
): string | undefined {
  if (value == null) return undefined;
  return requireUnsignedDecimal(value, field);
}

function requireFeeField(value: string | null | undefined, field: string): string {
  if (value == null) {
    throw new TxCompilerError('MISSING_FEE_PARAMS', `${field} is required for fee review`);
  }

  return requireUnsignedDecimal(value, field);
}

function resolveLegacyGasPrice(fee: FeeParams): string {
  if (fee.gasPrice != null) {
    return requireUnsignedDecimal(fee.gasPrice, 'gasPrice');
  }

  if (fee.maxFeePerGas != null) {
    return requireUnsignedDecimal(fee.maxFeePerGas, 'maxFeePerGas');
  }

  throw new TxCompilerError('MISSING_FEE_PARAMS', 'LEGACY requires gasPrice or maxFeePerGas');
}

function assertNativeCalldata(data: string | null): void {
  if (data == null || data === '' || data === '0x') {
    return;
  }

  throw new TxCompilerError('INVALID_PAYLOAD', 'EVM TRANSFER_NATIVE must not carry calldata', {
    dataLength: data.length,
  });
}

function assertTokenNativeValue(valueWei: string): void {
  if (requireUnsignedDecimal(valueWei, 'valueWei') !== '0') {
    throw new TxCompilerError(
      'INVALID_PAYLOAD',
      'EVM TRANSFER_TOKEN must not include native value',
      { valueWei },
    );
  }
}

function assertTronPreparedData(data: string | null): void {
  if (data == null || data === '' || data === '0x') {
    return;
  }

  throw new TxCompilerError('INVALID_PAYLOAD', 'Tron prepared payload must not include calldata', {
    dataLength: data.length,
  });
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

  return header;
}
