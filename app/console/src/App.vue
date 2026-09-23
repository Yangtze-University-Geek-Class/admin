<script setup lang="ts">
import { RouterView } from "vue-router";
import { TxToastHost } from "@talex-touch/tuffex/toast";
import ConfirmHost from "./components/ConfirmHost.vue";
</script>

<template>
  <RouterView />
  <ConfirmHost />
  <TxToastHost position="bottom-right" />
</template>
