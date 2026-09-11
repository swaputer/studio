import activeRelease from "../../config/base-sepolia.json";

interface UniswapV4Release {
  readonly universalRouter: string;
  readonly poolFee: number;
  readonly tickSpacing: number;
}

const candidateRelease = activeRelease as typeof activeRelease & {
  readonly upstream?: { readonly uniswapV4?: UniswapV4Release };
};

const configuredConfirmations = Number(activeRelease.indexer.confirmations);
if (!Number.isSafeInteger(configuredConfirmations) || configuredConfirmations < 1) {
  throw new Error("The active release must require at least one transaction confirmation.");
}
export const TRANSACTION_CONFIRMATIONS = configuredConfirmations;

const value = (name: string): string => String(import.meta.env[name] ?? "").trim();
export const PROTOCOL_EXPLORER_URL = value("VITE_PROTOCOL_EXPLORER_URL") || "http://127.0.0.1:4174";
const pinned = (name: string, expected: string): string => {
  const configured = value(name);
  if (configured && configured.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${name} does not match ${activeRelease.release.name}.`);
  }
  return expected;
};
export const NETWORK = Object.freeze({
  chainId: Number(pinned("VITE_CHAIN_ID", String(activeRelease.network.chainId))),
  get chainIdHex() { return `0x${this.chainId.toString(16)}`; },
  chainName: pinned("VITE_CHAIN_NAME", activeRelease.network.name),
  displayName: pinned("VITE_CHAIN_NAME", activeRelease.network.name),
  rpcUrl: value("VITE_RPC_URL") || "https://base-sepolia-rpc.publicnode.com",
  explorerUrl: pinned("VITE_EXPLORER_URL", activeRelease.network.explorerUrl),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
});

const worldId = pinned("VITE_SWAPVM_WORLD_ID", activeRelease.core.worldId);
const kernel = pinned("VITE_SWAPVM_KERNEL_ADDRESS", activeRelease.core.kernel);
const router = pinned("VITE_SWAPVM_ROUTER_ADDRESS", activeRelease.core.router);
const hook = pinned("VITE_SWAPVM_HOOK_ADDRESS", activeRelease.core.hook);
const gasToken = pinned("VITE_SWAPVM_GAS_TOKEN_ADDRESS", activeRelease.core.gasToken);
const uniswapV4 = candidateRelease.upstream?.uniswapV4;
const universalRouter = uniswapV4
  ? pinned("VITE_UNISWAP_UNIVERSAL_ROUTER_ADDRESS", uniswapV4.universalRouter)
  : "";
const vmInputWei = BigInt(pinned("VITE_SWAPVM_VM_INPUT_WEI", activeRelease.parameters.vmInputWei));
const sqrtPriceLimitX96 = BigInt(pinned("VITE_SWAPVM_SQRT_PRICE_LIMIT_X96", activeRelease.parameters.sqrtPriceLimitX96));

export const SWAPVM = Object.freeze({
  protocolVersion: pinned("VITE_SWAPVM_PROTOCOL_VERSION", activeRelease.release.protocolVersion),
  worldId,
  kernel,
  router,
  hook,
  gasToken,
  universalRouter,
  poolFee: uniswapV4?.poolFee ?? 0,
  tickSpacing: uniswapV4?.tickSpacing ?? 0,
  vmInputWei,
  sqrtPriceLimitX96,
  minNetTokenOut: BigInt(pinned("VITE_SWAPVM_MIN_NET_TOKEN_OUT", activeRelease.parameters.minNetTokenOut)),
  enabled:
    /^0x[0-9a-fA-F]{64}$/.test(worldId)
    && /^0x[0-9a-fA-F]{40}$/.test(kernel)
    && /^0x[0-9a-fA-F]{40}$/.test(router)
    && /^0x[0-9a-fA-F]{40}$/.test(hook)
    && /^0x[0-9a-fA-F]{40}$/.test(gasToken),
  directEnabled:
    /^0x[0-9a-fA-F]{40}$/.test(universalRouter)
    && Number.isInteger(uniswapV4?.poolFee)
    && Number.isInteger(uniswapV4?.tickSpacing)
});

export const KERNEL_ABI = [
  "event Events(bytes32 indexed worldId, uint64 indexed executionHeight, bytes payload)",
  "function eoaAccountId(address account) view returns (bytes32)",
  "function creatorNonce(bytes32 worldId, bytes32 creator) view returns (uint64)",
  "function contractAccountId(bytes32 worldId,bytes32 creator,uint64 creationNonce,bytes32 codeHash) pure returns (bytes32)",
  "function nonces(bytes32 worldId, bytes32 actor) view returns (uint64)",
  "function programCodeHash(bytes32 worldId,bytes32 target) view returns (bytes32)",
  "function staticCall(bytes32 worldId, bytes32 target, bytes input, uint32 byteLimit) view returns (bytes output, uint32 bytesUsed)"
] as const;
