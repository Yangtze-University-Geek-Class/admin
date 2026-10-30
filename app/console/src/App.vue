<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { RouterView } from "vue-router";

const ConfirmHost = defineAsyncComponent(() => import("./components/ConfirmHost.vue"));
const TxToastHost = defineAsyncComponent(() => import("@talex-touch/tuffex/toast").then(m => m.TxToastHost));
</script>

<template>
  <RouterView />
  <ConfirmHost />
  <TxToastHost position="bottom-right" />
</template>
