<script setup lang="ts">
// Header on top, sidebar + page side by side. Under 1024px the sidebar column
// disappears and the same ForumSidebar is served from a left drawer instead.
const { isDesktop, sidebarOpen, drawerOpen } = useShell()

const sidebarVisible = computed(() => isDesktop.value && sidebarOpen.value)
</script>

<template>
  <div class="min-h-screen">
    <ForumHeader />
    <AdoptionNotice />

    <TxContainer max-width="1400px" class="py-6">
      <LocalSnapshotGate>
        <TxRow :gutter="24">
          <TxCol v-if="sidebarVisible" :span="24" :lg="6" :xl="5">
            <div class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
              <ForumSidebar />
            </div>
          </TxCol>
          <TxCol :span="24" :lg="sidebarVisible ? 18 : 24" :xl="sidebarVisible ? 19 : 24">
            <slot />
          </TxCol>
        </TxRow>
      </LocalSnapshotGate>
    </TxContainer>

    <TxDrawer
      v-if="!isDesktop"
      v-model:visible="drawerOpen"
      direction="left"
      :size="300"
      title="导航"
      :mobile-adapt="false"
    >
      <ForumSidebar @navigate="drawerOpen = false" />
    </TxDrawer>

    <!-- Mock identity picker in demo login mode; under the site-wide login a short toast, so every "登录" trigger still answers. -->
    <LoginModal />
  </div>
</template>
