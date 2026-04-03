/**
 * Shared prepared transaction fixtures for compiler and review tests.
 */

import type { PreparedTransaction } from '../src/types.js';

export const EVM_NATIVE_EIP1559: PreparedTransaction = {
  chain: 'ethereum',
  chainId: 1,
  from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  to: '0x0000000000000000000000000000000000000001',
  valueWei: '1000000000000000000',
  data: null,
  txType: 'TRANSFER_NATIVE',
  tokenContract: null,
  nonce: '1649',
  fee: {
    mode: 'EIP1559',
    gasLimit: '24338',
    baseFeePerGas: '107264908',
    maxPriorityFeePerGas: '1000000000',
    maxFeePerGas: '1214529816',
  },
};

export const EVM_NATIVE_LEGACY: PreparedTransaction = {
  chain: 'ethereum',
  chainId: 56,
  from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  valueWei: '500000000000000000',
  data: null,
  txType: 'TRANSFER_NATIVE',
  tokenContract: null,
  nonce: '42',
  fee: {
    mode: 'LEGACY',
    gasLimit: '21000',
    gasPrice: '5000000000',
  },
};

export const EVM_TOKEN_EIP1559: PreparedTransaction = {
  chain: 'ethereum',
  chainId: 1,
  from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  valueWei: '0',
  data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4240',
  txType: 'TRANSFER_TOKEN',
  tokenContract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  nonce: '1649',
  fee: {
    mode: 'EIP1559',
    gasLimit: '46251',
    baseFeePerGas: '107264908',
    maxPriorityFeePerGas: '1000000000',
    maxFeePerGas: '1214529816',
  },
};

export const TRON_BLOCK_HEADER = {
  h: '0000000003b8e4b2a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
  n: 62522546,
  t: 1710000000000,
  p: '0000000003b8e4b100000000000000000000000000000000000000000000000000000000',
  r: 'aabbccdd',
  w: '41abcdef1234567890abcdef1234567890abcdef12',
  v: 30,
} as const;

export const TRON_NATIVE: PreparedTransaction = {
  chain: 'tron',
  chainId: null,
  from: '41d8da6bf26964af9d7eed9e03e53415d37aa96045',
  to: '410000000000000000000000000000000000000001',
  valueWei: '5000000',
  data: null,
  txType: 'TRANSFER_NATIVE',
  tokenContract: null,
  nonce: null,
  fee: {
    mode: 'TRON',
    el: null,
    rp: TRON_BLOCK_HEADER,
  },
};

export const TRON_TOKEN: PreparedTransaction = {
  chain: 'tron',
  chainId: null,
  from: '41d8da6bf26964af9d7eed9e03e53415d37aa96045',
  to: '410000000000000000000000000000000000000001',
  valueWei: '1000000',
  data: null,
  txType: 'TRANSFER_TOKEN',
  tokenContract: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
  nonce: null,
  fee: {
    mode: 'TRON',
    el: '30000000',
    rp: TRON_BLOCK_HEADER,
  },
};

export const FIXED_NOW = 1710000060000;
