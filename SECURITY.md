# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in this package please report it privately.

Do not open a public GitHub issue for security reports.

Send the report to `security@walletsuite.io`.

Please include:

- a short description of the issue
- reproduction steps or a proof of concept
- the expected impact
- any suggested remediation if you already have one

We aim to acknowledge reports within 48 hours and prioritize critical issues for immediate investigation.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Scope

This library handles transaction validation review and compilation only. It does not manage private keys signing broadcasting or RPC communication.

In scope:

- validation bypasses
- incorrect transaction compilation
- review output that does not match compiled transaction intent
- chain specific parsing bugs that could misrepresent the transaction being signed
