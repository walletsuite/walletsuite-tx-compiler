# WalletSuite TX Compiler

[![npm version](https://img.shields.io/npm/v/%40walletsuite%2Ftx-compiler?logo=npm)](https://www.npmjs.com/package/@walletsuite/tx-compiler)
[![CI](https://github.com/walletsuite/walletsuite-tx-compiler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/walletsuite/walletsuite-tx-compiler/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/walletsuite/walletsuite-tx-compiler)](https://github.com/walletsuite/walletsuite-tx-compiler/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19.0-339933?logo=node.js&logoColor=white)](https://github.com/walletsuite/walletsuite-tx-compiler/blob/main/package.json)

TypeScript library for deterministic Ethereum and Tron transaction compilation from WalletSuite prepared payloads.

Package name: `@walletsuite/tx-compiler`

## Overview

WalletSuite TX Compiler turns the canonical prepared transaction payload returned by the WalletSuite backend into:

- unsigned transaction bytes
- transaction hashes ready for signing
- human review data for confirmation screens

It is designed to keep the signing boundary explicit:

- the backend prepares the transaction intent and fee parameters
- this library validates the payload and derives the exact unsigned artifacts
- the signer signs
- the consumer assembles and broadcasts where required by the chain

## What it does not do

This library does not:

- sign transactions
- broadcast transactions
- discover fees or nonces
- perform RPC calls
- simulate contract calls
- resolve tokens or balances
- handle arbitrary contract interactions beyond transfer flows

## Supported transactions

| Chain    | Type              | Fee mode           |
| -------- | ----------------- | ------------------ |
| Ethereum | `TRANSFER_NATIVE` | `EIP1559` `LEGACY` |
| Ethereum | `TRANSFER_TOKEN`  | `EIP1559` `LEGACY` |
| Tron     | `TRANSFER_NATIVE` | `TRON`             |
| Tron     | `TRANSFER_TOKEN`  | `TRON`             |

## Installation

```bash
npm install @walletsuite/tx-compiler
```

## Quick start

```ts
import { compile, review, validate } from '@walletsuite/tx-compiler';

const prepared = validate(backendPayload);

const reviewData = review(prepared);
const result = compile(prepared);

console.log(reviewData.recipient);
console.log(result.unsignedTx);
console.log(result.txHash);
```

## API

### `validate(input: unknown): PreparedTransaction`

Validates raw backend payloads and returns a typed `PreparedTransaction`.

```ts
import { validate } from '@walletsuite/tx-compiler';

const prepared = validate(rawPayload);
```

### `review(prepared: PreparedTransaction): TransactionReview`

Builds a human review summary from a validated prepared transaction. For EVM token transfers the
recipient and amount are decoded from calldata instead of trusting the raw envelope fields.

```ts
import { review } from '@walletsuite/tx-compiler';

const summary = review(prepared);
```

### `compile(prepared: PreparedTransaction, options?: CompileOptions): CompilationResult`

Compiles a validated prepared transaction into unsigned signer ready artifacts.

```ts
import { compile } from '@walletsuite/tx-compiler';

const { unsignedTx, txHash, metadata } = compile(prepared);
```

### `isValidTronAddress(input: string): boolean`

Checks whether a base58 Tron address is valid.

### `tronAddressToBytes(address: string): Uint8Array`

Converts a base58 Tron address to its raw 21 byte representation.

## Output formats

| Chain    | `unsignedTx`                            | `txHash`                          |
| -------- | --------------------------------------- | --------------------------------- |
| Ethereum | RLP encoded unsigned transaction        | keccak256 of the unsigned payload |
| Tron     | Protobuf encoded `Transaction.raw_data` | SHA 256 of the raw data           |

For Tron the consumer still needs to assemble the signed transaction protobuf before broadcast.

## Compile options

```ts
interface CompileOptions {
  now?: number;
}
```

`now` overrides wall clock time for deterministic Tron transaction compilation in tests and controlled integration flows.

## Error handling

All library errors are instances of `TxCompilerError`.

| Code                   | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `INVALID_PAYLOAD`      | Missing or malformed field in the input                 |
| `UNSUPPORTED_CHAIN`    | Chain not supported by this library                     |
| `UNSUPPORTED_TX_TYPE`  | Transaction type not supported                          |
| `UNSUPPORTED_FEE_MODE` | Fee mode does not match the chain                       |
| `INVALID_ADDRESS`      | Address fails format validation                         |
| `INVALID_AMOUNT`       | Amount is not a valid non negative integer              |
| `MISSING_FEE_PARAMS`   | Required fee parameters are missing                     |
| `INVALID_BLOCK_HEADER` | Tron block header is missing or malformed               |
| `INVALID_CALLDATA`     | EVM calldata does not match the expected transfer shape |
| `COMPILATION_FAILED`   | Unexpected failure during compilation                   |

```ts
import { TxCompilerError, validate } from '@walletsuite/tx-compiler';

try {
  validate(input);
} catch (error) {
  if (error instanceof TxCompilerError) {
    console.error(error.code, error.message, error.details);
  }
}
```

## Development

Node `20.19.0` or newer is required for the current dependency set.

```bash
npm install
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm pack --dry-run
```

## License

Apache-2.0
