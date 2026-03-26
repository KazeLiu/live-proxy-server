<template>
  <main class="logs-page">
    <header class="logs-header">
      <div>
        <h1>日志</h1>
        <p>实时查看后端控制台输出</p>
      </div>
      <div class="actions">
        <button class="btn-outline" @click="clearLogs">清空</button>
        <button class="btn" @click="toggleAutoScroll">
          {{ autoScroll ? '关闭自动滚动' : '开启自动滚动' }}
        </button>
      </div>
    </header>

    <section class="logs-panel" ref="panelRef">
      <div v-if="!logs.length" class="empty">暂无日志</div>
      <div v-else class="logs-list">
        <div
          v-for="(item, index) in logs"
          :key="`${item.timestamp}-${index}`"
          class="log-row"
          :class="`level-${item.level}`"
        >
          <span class="time">{{ formatTime(item.timestamp) }}</span>
          <span class="level">{{ item.level.toUpperCase() }}</span>
          <span class="message">{{ item.message }}</span>
        </div>
      </div>
    </section>

    <footer class="logs-footer" :class="statusClass">
      <span class="dot"></span>
      <span>{{ statusText }}</span>
    </footer>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const DEFAULT_PORT = 8899;
const apiPort = ref(Number(localStorage.getItem('backend_port')) || DEFAULT_PORT);
const apiOrigin = computed(() => `http://127.0.0.1:${apiPort.value}`);

const logs = ref([]);
const statusText = ref('正在连接...');
const statusClass = computed(() => {
  if (statusText.value.includes('已连接')) return 'online';
  if (statusText.value.includes('已断开')) return 'offline';
  if (statusText.value.includes('失败')) return 'offline';
  return 'pending';
});

const autoScroll = ref(true);
const panelRef = ref(null);
let eventSource = null;
let portWatcher = null;

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString();
};

const scrollToBottom = () => {
  if (!autoScroll.value || !panelRef.value) return;
  panelRef.value.scrollTop = panelRef.value.scrollHeight;
};

const connect = () => {
  if (eventSource) {
    eventSource.close();
  }
  statusText.value = '正在连接...';
  eventSource = new EventSource(`${apiOrigin.value}/logs`);
  eventSource.onopen = () => {
    statusText.value = '已连接后端日志';
  };
  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      logs.value.push(payload);
      if (logs.value.length > 500) {
        logs.value.splice(0, logs.value.length - 500);
      }
      nextTick(scrollToBottom);
    } catch (error) {
      // ignore parse error
    }
  };
  eventSource.onerror = () => {
    statusText.value = '连接失败，正在重试...';
  };
};

const syncPort = () => {
  const stored = Number(localStorage.getItem('backend_port')) || DEFAULT_PORT;
  if (stored !== apiPort.value) {
    apiPort.value = stored;
    connect();
  }
};

const clearLogs = () => {
  logs.value = [];
};

const toggleAutoScroll = () => {
  autoScroll.value = !autoScroll.value;
  nextTick(scrollToBottom);
};

onMounted(() => {
  connect();
  portWatcher = window.setInterval(syncPort, 1000);
  window.addEventListener('storage', syncPort);
});

onBeforeUnmount(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (portWatcher) {
    window.clearInterval(portWatcher);
    portWatcher = null;
  }
  window.removeEventListener('storage', syncPort);
});
</script>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-radius: 16px;
  padding: 20px 24px;
  border: 1px solid #eef2f7;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
}

.logs-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #0f172a;
}

.logs-header p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn,
.btn-outline {
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn {
  border: none;
  background: #2563eb;
  color: #fff;
}

.btn-outline {
  border: 1px solid #cbd5f5;
  background: #f8fafc;
  color: #1d4ed8;
}

.logs-panel {
  flex: 1;
  background: #0f172a;
  border-radius: 18px;
  padding: 16px;
  min-height: 420px;
  max-height: 65vh;
  overflow: auto;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  border: 1px solid #1f2937;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-row {
  display: grid;
  grid-template-columns: 92px 70px 1fr;
  gap: 12px;
  align-items: start;
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.6);
}

.log-row .time {
  color: #94a3b8;
}

.log-row .level {
  font-weight: 600;
  text-transform: uppercase;
  color: #cbd5f5;
}

.log-row.level-warn {
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.log-row.level-error {
  border: 1px solid rgba(248, 113, 113, 0.4);
}

.log-row.level-info {
  border: 1px solid rgba(96, 165, 250, 0.3);
}

.log-row.level-log {
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.message {
  word-break: break-word;
}

.empty {
  text-align: center;
  padding: 60px 12px;
  color: #94a3b8;
  font-size: 13px;
}

.logs-footer {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  width: fit-content;
  background: #f1f5f9;
  color: #475569;
}

.logs-footer .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}

.logs-footer.online {
  background: #dcfce7;
  color: #166534;
}

.logs-footer.online .dot {
  background: #22c55e;
}

.logs-footer.offline {
  background: #fee2e2;
  color: #991b1b;
}

.logs-footer.offline .dot {
  background: #ef4444;
}

.logs-footer.pending {
  background: #e2e8f0;
  color: #475569;
}

@media (max-width: 720px) {
  .logs-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .log-row {
    grid-template-columns: 1fr;
  }
}
</style>
