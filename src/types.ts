/**
 * Core type definitions for the WalletSuite transaction compiler.
 *
 * Input types match the backend's PrepareSignResponseDto.
 * Output types describe compilation artifacts and review objects.
 */

// ---------------------------------------------------------------------------
// Input types — match backend PrepareSignResponseDto
// ---------------------------------------------------------------------------

/** Fee calculation mode determined by backend */
export type FeeMode = 'EIP1559' | 'LEGACY' | 'TRON';

/** Transaction intent type */
export type TxType = 'TRANSFER_NATIVE' | 'TRANSFER_TOKEN';

/** Supported chain identifier */
export type Chain = 'ethereum' | 'tron';

/** Tron block header reference used for replay protection */
export interface TronBlockHeader {
  /** Block ID (hex hash, no 0x prefix) */
  readonly h: string;
  /** Block number */
  readonly n: number;
  /** Block timestamp in milliseconds */
  readonly t: number;
  /** Parent block hash */
  readonly p?: string;
  /** Transaction trie root */
  readonly r?: string;
  /** Witness (block producer) address */
  readonly w?: string;
  /** Protocol version */
  readonly v: number;
}

/** Fee parameters from the backend, mode-discriminated */
export interface FeeParams {
  readonly mode: FeeMode;
  /** Gas unit limit (EVM only) */
  readonly gasLimit?: string | null;
  /** Base fee per gas in wei (EIP-1559 only) */
  readonly baseFeePerGas?: string | null;
  /** Priority fee (tip) per gas in wei (EIP-1559 only) */
  readonly maxPriorityFeePerGas?: string | null;
  /** Maximum fee per gas in wei (EIP-1559 only) */
  readonly maxFeePerGas?: string | null;
  /** Gas price in wei (LEGACY only) */
  readonly gasPrice?: string | null;
  /** Tron energy fee limit in SUN */
  readonly el?: string | null;
  /** Tron block header for transaction construction */
  readonly rp?: TronBlockHeader | null;
}

/** Canonical prepared transaction payload from the WalletSuite backend */
export interface PreparedTransaction {
  readonly chain: Chain;
  readonly chainId: number | null;
  readonly from: string;
  readonly to: string;
  /** Amount in smallest units (wei / SUN), always a decimal string */
  readonly valueWei: string;
  /** ABI-encoded calldata (EVM token transfers); null otherwise */
  readonly data: string | null;
  readonly txType: TxType;
  /** Token contract address (token transfers only) */
  readonly tokenContract: string | null;
  /** Transaction nonce (EVM only) */
  readonly nonce: string | null;
  readonly fee: FeeParams;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Result of compiling a prepared transaction */
export interface CompilationResult {
  readonly chain: Chain;
  /** Hex-encoded unsigned transaction (0x-prefixed) */
  readonly unsignedTx: string;
  /** Hash to sign — keccak256 for EVM, SHA-256 for Tron (0x-prefixed) */
  readonly txHash: string;
  readonly metadata: CompilationMetadata;
}

export interface CompilationMetadata {
  readonly txType: TxType;
  readonly feeMode: FeeMode;
  /** EVM transaction envelope type: 0 = legacy, 2 = EIP-1559 */
  readonly evmTxType?: number;
  /** Tron contract type: 1 = TransferContract, 31 = TriggerSmartContract */
  readonly tronContractType?: number;
  /** Tron transaction expiration timestamp in ms */
  readonly expiration?: number;
}

/** Human-reviewable representation of a transaction */
export interface TransactionReview {
  readonly chain: Chain;
  readonly txType: TxType;
  readonly from: string;
  /** Actual recipient — decoded from calldata for EVM token transfers */
  readonly recipient: string;
  /** Transfer amount in smallest units (decimal string) */
  readonly amount: string;
  readonly tokenContract: string | null;
  readonly nonce: string | null;
  readonly chainId: number | null;
  readonly fee: FeeReview;
}

export interface FeeReview {
  readonly mode: FeeMode;
  /** Estimated maximum fee cost in smallest native units, or null if unknown */
  readonly estimatedMaxCost: string | null;
  readonly gasLimit?: string;
  readonly gasPrice?: string;
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  readonly baseFeePerGas?: string;
  /** Tron fee limit in SUN */
  readonly tronFeeLimit?: string;
}

/** Options for the compile step */
export interface CompileOptions {
  /** Override wall-clock time for Tron transactions. Defaults to Date.now(). */
  readonly now?: number;
}
