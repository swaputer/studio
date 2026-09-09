import { computed, ref, shallowRef } from "vue";
import type { BrowserProvider, Signer } from "ethers";
import { connectWallet, friendlyError } from "@/lib/protocol";
import { toast } from "@/composables/useToast";
import { NETWORK } from "@/lib/config";

const address = ref<string | null>(null);
// ethers instances carry private fields. They must not be wrapped in Vue's
// deep reactive Proxy or ethers will reject the proxied instance at call time.
const provider = shallowRef<BrowserProvider | null>(null);
const signer = shallowRef<Signer | null>(null);
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
  connecting.value = false;
}

function changed() {
  if (!source && !address.value && !signer.value) return;
  disconnect();
  toast.error("Your wallet account or network changed. Reconnect before continuing.");
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
      const chainId = await injected.request({ method: "eth_chainId" });
      if (BigInt(String(chainId)) !== BigInt(NETWORK.chainId)) throw new Error(`Switch your wallet to ${NETWORK.displayName} to continue.`);
      if (version !== attempt) return;
      source = injected;
      source.on?.("accountsChanged", changed);
      source.on?.("chainChanged", changed);
      address.value = wallet.address;
      provider.value = wallet.provider;
      signer.value = wallet.signer;
      session.value += 1;
    } catch (cause) {
      if (version === attempt) toast.error(friendlyError(cause));
    } finally {
      if (version === attempt) connecting.value = false;
    }
  };

  return {
    address,
    provider,
    signer,
    connecting,
    session,
    connected: computed(() => Boolean(address.value)),
    connect,
    disconnect
  };
}
