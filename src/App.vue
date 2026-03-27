<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-dot" :class="statusClass"></span>
        <span class="brand-title">Live Proxy Studio</span>
      </div>
      <nav class="nav-links">
        <RouterLink class="nav-link" to="/m3u">生成 m3u</RouterLink>
        <RouterLink class="nav-link" to="/cookies">Cookies</RouterLink>
        <RouterLink class="nav-link" to="/logs">日志</RouterLink>
        <RouterLink class="nav-link" to="/settings">系统设置</RouterLink>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { RouterLink, RouterView } from 'vue-router';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getApiOrigin, getDefaultPort, resolveInitialBackendPort } from './utils/apiConfig.js';

const DEFAULT_PORT = getDefaultPort();
const apiPort = ref(DEFAULT_PORT);
const apiOrigin = computed(() => getApiOrigin(apiPort.value));
const backendAlive = ref(false);
const statusClass = computed(() => (backendAlive.value ? 'is-online' : 'is-offline'));

let pollTimer = null;

const checkBackend = async () => {
  try {
    const resp = await fetch(`${apiOrigin.value}/config`, { cache: 'no-store' });
    backendAlive.value = resp.ok;
  } catch (error) {
    backendAlive.value = false;
  }
};

const startPolling = () => {
  if (pollTimer) return;
  checkBackend();
  pollTimer = window.setInterval(checkBackend, 3000);
};

const stopPolling = () => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

onMounted(async () => {
  apiPort.value = await resolveInitialBackendPort();
  startPolling();
});
onBeforeUnmount(stopPolling);
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #f6f7fb;
  color: #1f2937;
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 18px;
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 0 10px rgba(148, 163, 184, 0.4);
  background: #94a3b8;
  animation: breathe 2s ease-in-out infinite;
}

.brand-dot.is-online {
  background: #22c55e;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.65);
}

.brand-dot.is-offline {
  background: #ef4444;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.65);
}

@keyframes breathe {
  0% {
    transform: scale(0.9);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(0.9);
    opacity: 0.6;
  }
}

.nav-links {
  display: flex;
  gap: 10px;
}

.nav-link {
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 14px;
  color: #6b7280;
  text-decoration: none;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.nav-link:hover {
  color: #1f2937;
  border-color: #d1d5db;
  background: #f9fafb;
}

.nav-link.router-link-active {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
  font-weight: 600;
}

.app-main {
  flex: 1;
  padding: 24px;
}
</style>
