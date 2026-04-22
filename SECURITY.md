# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please report security vulnerabilities privately to
**security@walletsuite.io**. Do not open a public GitHub issue for
security bugs. Reports are acknowledged within 5 business days.

## Scope

This crate produces deterministic unsigned transaction bytes for Ethereum
(EVM) and Tron. Vulnerabilities of particular interest include:

- Byte-level divergence between compiled output and the relevant spec
  (EIP-1559 / EIP-155 / Tron protobuf `Transaction.raw_data`) that would
  cause signed transactions to fail on-chain or succeed with unexpected
  semantics.
- Missing or incorrect validation that allows a caller to produce a
  malformed transaction envelope.
- Address-parsing ambiguities (EIP-55 casing, Tron base58check edge cases).
- Integer overflow or panics on untrusted input.

## Responsible Disclosure

Reporters are asked to:
- Allow a reasonable remediation window before public disclosure.
- Avoid testing against production wallets not owned by the reporter.
- Not violate any law or breach any agreement to discover vulnerabilities.

## Trust Assumptions

This library does **not** sign transactions, hold keys, or broadcast to
the network. It transforms a validated `PreparedTransaction` into
`(unsignedTx, txHash)`. Key material and broadcast responsibility live
in the caller (a hardware wallet, HSM, or signing service).
