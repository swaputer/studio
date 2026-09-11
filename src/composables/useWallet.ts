import { computed, ref, shallowRef } from "vue";
import type { BrowserProvider, Signer } from "ethers";
import { connectWallet, friendlyError, switchWalletToSupportedNetwork } from "@/lib/protocol";
import { toast } from "@/composables/useToast";
import { NETWORK } from "@/lib/config";

const address = ref<string | null>(null);
// ethers instances carry private fields. They must not be wrapped in Vue's
// deep reactive Proxy or ethers will reject the proxied instance at call time.
const provider = shallowRef<BrowserProvider | null>(null);
const signer = shallowRef<Signer | null>(null);
const chainId = ref<bigint | null>(null);
const connecting = ref(false);
const session = ref(0);
let source: EthereumProvider | undefined;
let attempt = 0;

function disconnect() {
  ++attempt;
  session.value += 1;
  source?.removeListener?.("accountsChanged", changed);
  source?.removeListener?.("chainChanged", changed);
  source = undefined;
  address.value = null;
  provider.value = null;
  signer.value = null;
  chainId.value = null;
  connecting.value = false;
}

async function changed() {
  if (!source) return;
  const version = ++attempt;
  session.value += 1;
  try {
    const accounts = await source.request({ method: "eth_accounts" }) as string[];
    if (!accounts.length) { disconnect(); return; }
    const wallet = await connectWallet(false);
    if (version !== attempt) return;
    address.value = wallet.address;
    provider.value = wallet.provider;
    signer.value = wallet.signer;
    chainId.value = wallet.chainId;
    if (wallet.chainId !== BigInt(NETWORK.chainId)) {
      toast.error(`Swaputer Studio does not support this network. Switch to ${NETWORK.displayName} to continue.`);
    }
  } catch (cause) {
    if (version === attempt) {
      disconnect();
      toast.error(friendlyError(cause));
    }
  }
}

export function useWallet() {
  const connect = async () => {
    if (connecting.value || address.value) return;
    const version = ++attempt;
    connecting.value = true;
    try {
      const wallet = await connectWallet();
      const injected = window.ethereum;
      if (!injected) throw new Error("No compatible browser wallet was detected.");
      if (version !== attempt) return;
      source = injected;
      source.on?.("accountsChanged", changed);
      source.on?.("chainChanged", changed);
      address.value = wallet.address;
      provider.value = wallet.provider;
      signer.value = wallet.signer;
      chainId.value = wallet.chainId;
      session.value += 1;
      if (wallet.chainId !== BigInt(NETWORK.chainId)) {
        toast.error(`Swaputer Studio does not support this network. Switch to ${NETWORK.displayName} to continue.`);
      }
    } catch (cause) {
      if (version === attempt) toast.error(friendlyError(cause));
    } finally {
      if (version === attempt) connecting.value = false;
    }
  };

  const switchNetwork = async () => {
    if (connecting.value) return;
    const activeProvider = provider.value;
    if (!activeProvider) { await connect(); return; }
    connecting.value = true;
    try {
      await switchWalletToSupportedNetwork(activeProvider);
      await changed();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      connecting.value = false;
    }
  };

  const networkSupported = computed(() => chainId.value === BigInt(NETWORK.chainId));
  const networkLabel = computed(() => {
    if (chainId.value === null) return "Not connected";
    return networkSupported.value ? NETWORK.displayName : `Chain ${chainId.value.toString()}`;
  });

  return {
    address,
    provider,
    signer,
    chainId,
    connecting,
    session,
    connected: computed(() => Boolean(address.value)),
    networkSupported,
    networkLabel,
    connect,
    switchNetwork,
    disconnect
  };
}
