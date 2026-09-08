# Swaputer Studio

Standalone TinySol development environment for Swaputer. Studio lets developers write, compile, deploy, and interact with SVM Mini Contracts from the browser.

## Development

```bash
npm install
npm run dev
```

The local server listens on `http://127.0.0.1:4176`. Copy `.env.example` to `.env.local` when a custom RPC or protocol explorer URL is required.

## Verification

```bash
npm test
npm run build
npx playwright test
```

The compiler is the published `@swaputer-labs/tinysol` package. Protocol addresses are pinned in `config/base-sepolia.json`; build-time overrides must match that release.

Licensed under the MIT License.
