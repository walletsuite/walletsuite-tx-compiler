# WalletSuite TX Compiler

TypeScript library for deterministic transaction compilation from WalletSuite prepared payloads.

Package name: `@walletsuite/tx-compiler`

## Status

This repository is being assembled in small reviewable commits.

The initial bootstrap includes:

- package metadata and release configuration
- TypeScript, linting, formatting, testing, and build setup
- CI and dependency update automation
- shared public types and structured error primitives

Chain compilers, runtime validation, and review helpers land in subsequent commits.

## Development

Node `20.19.0` or newer is required for the current dependency set.

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## License

Apache-2.0
