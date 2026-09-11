<script setup lang="ts">
import { computed } from "vue";
import { TriangleAlert, Wallet } from "@lucide/vue";
import { useWallet } from "@/composables/useWallet";
import { short } from "@/lib/protocol";

const wallet = useWallet();
const walletLabel = computed(() => wallet.connecting.value
  ? "Connecting…"
  : wallet.address.value && !wallet.networkSupported.value
    ? "Switch network"
    : wallet.address.value ? short(wallet.address.value) : "Connect wallet");
const walletAction = () => wallet.address.value && !wallet.networkSupported.value ? wallet.switchNetwork() : wallet.connect();
</script>

<template>
  <header class="site-header studio-header">
    <div class="site-header__inner">
      <div class="brand" aria-label="Swaputer">
        <img class="brand-mark" src="/swaputer-mark.png" alt="" />
        <span>Swaputer</span>
      </div>
      <div class="site-actions">
        <button :class="['wallet-button', { 'wallet-button--warning': wallet.address.value && !wallet.networkSupported.value }]" type="button" :disabled="wallet.connecting.value" @click="walletAction">
          <TriangleAlert v-if="wallet.address.value && !wallet.networkSupported.value" :size="16" />
          <Wallet v-else :size="16" />
          <span>{{ walletLabel }}</span>
        </button>
      </div>
    </div>
  </header>
</template>
