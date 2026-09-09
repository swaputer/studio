# Swaputer Studio

Standalone TinySol development environment for Swaputer. Studio lets developers write, compile, deploy, and interact with SVM Mini Contracts from a desktop browser.

Studio keeps a local multi-file workspace in the browser. Developers can create, switch, save and delete TinySol files; the bundled template library intentionally contains only `Counter`. Selecting an existing template switches to its file without overwriting edits. Phones and narrow screens show a desktop-access notice instead of a reduced editor.

## Development

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

The local server listens on `http://127.0.0.1:4176`. Copy `.env.example` to `.env.local` when a custom RPC or protocol explorer URL is required.

| Setting | Purpose |
| --- | --- |
| `VITE_RPC_URL` | Read-only RPC and wallet network metadata |
| `VITE_PROTOCOL_EXPLORER_URL` | Swaputer Explorer link shown in Studio |

## Verification

```sh
npm test
npm run typecheck
npm run build
npx playwright test
```

The compiler is the published `@swaputer-labs/tinysol@0.3.2` package, and
confirmed Kernel receipts are decoded with
`@swaputer-labs/receipt-codec@0.1.2`. Protocol addresses are pinned in
`config/base-sepolia.json`; build-time overrides must match that release.
Wallet account or network changes invalidate the active Studio signer and
require reconnection.

Deployments and state-changing calls share one protocol-write lock. A write is shown as confirmed only after the manifest's confirmation policy has been met (12 blocks in the bundled Base Sepolia release) and Studio has re-read the transaction, receipt and containing block to verify their canonical linkage. Studio then decodes the deployed program ID from that receipt; if an RPC cannot determine final transaction status, it keeps the full hash available for Explorer reconciliation and blocks another write until reload.

## Deployment

Serve `dist/` over HTTPS with SPA fallback routing and the security headers in `nginx.conf.template`. A standalone image is included:

```sh
docker build --pull \
  --build-arg VITE_PROTOCOL_EXPLORER_URL=https://YOUR_EXPLORER_HOST \
  --build-arg VITE_RPC_URL=https://YOUR_RPC_HOST \
  -t swaputer-studio .
docker run --rm -p 127.0.0.1:4176:8080 swaputer-studio
```

The image has no indexer dependency; Studio talks to the configured RPC endpoint directly.

Licensed under the MIT License.
