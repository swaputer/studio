<script setup lang="ts">
import AppToast from "@/components/AppToast.vue";
import StudioHeader from "@/components/StudioHeader.vue";
import StudioView from "@/views/StudioView.vue";
</script>

<template>
  <div class="app-shell">
    <StudioHeader />
    <StudioView />
    <AppToast />
  </div>
</template>
