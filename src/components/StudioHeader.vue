<script setup lang="ts">
import { computed } from "vue";
import { ArrowUpRight, Wallet } from "@lucide/vue";
import { useWallet } from "@/composables/useWallet";
import { PROTOCOL_EXPLORER_URL } from "@/lib/config";
import { short } from "@/lib/protocol";

const wallet = useWallet();
const walletLabel = computed(() => wallet.connecting.value ? "Connecting…" : wallet.address.value ? short(wallet.address.value) : "Connect wallet");
</script>

<template>
  <header class="site-header studio-header">
    <div class="site-header__inner">
      <a class="brand" :href="PROTOCOL_EXPLORER_URL" aria-label="Open Swaputer Explorer">
        <img class="brand-mark" src="/swaputer-mark.png" alt="" />
        <span>Swaputer</span>
      </a>
      <span class="studio-header__product">Studio</span>
      <div class="site-actions">
        <a class="studio-header__explorer" :href="PROTOCOL_EXPLORER_URL">Explorer <ArrowUpRight :size="13" /></a>
        <button class="wallet-button" type="button" :disabled="wallet.connecting.value" @click="wallet.connect">
          <Wallet :size="16" />
          <span>{{ walletLabel }}</span>
        </button>
      </div>
    </div>
  </header>
</template>
