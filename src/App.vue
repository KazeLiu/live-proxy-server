<template>
  <main class="page">
    <h1 class="title">设置</h1>
    <p class="status" :class="statusClass">{{ statusText }}</p>

    <section class="card">
      <label class="label" for="streamlink">STREAMLINK_CMD</label>
      <div class="row">
        <input
          id="streamlink"
          class="input"
          type="text"
          v-model="form.STREAMLINK_CMD"
          placeholder="C:\\Program Files\\Streamlink\\bin\\streamlink.exe"
        />
        <button class="btn secondary" type="button" @click="pickStreamlink">选择文件</button>
      </div>

      <label class="label" for="httpProxy">httpProxy</label>
      <input
        id="httpProxy"
        class="input"
        type="text"
        v-model="form.httpProxy"
        placeholder="http://127.0.0.1:7897"
      />

      <label class="label" for="port">port</label>
      <input
        id="port"
        class="input"
        type="number"
        min="1"
        v-model.number="form.port"
        placeholder="8899"
      />

      <div class="actions">
        <button class="btn" type="button" @click="saveConfig" :disabled="isSaving">
          {{ isSaving ? '保存中...' : '保存并重启' }}
        </button>
        <button class="btn ghost" type="button" @click="loadConfig">恢复当前配置</button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';

const DEFAULT_PORT = 8899;
const apiPort = ref(Number(localStorage.getItem('backend_port')) || DEFAULT_PORT);
const apiOrigin = computed(() => `http://127.0.0.1:${apiPort.value}`);

const form = reactive({
  STREAMLINK_CMD: '',
  httpProxy: '',
  port: DEFAULT_PORT
});

const statusText = ref('正在连接...');
const statusClass = computed(() => {
  if (statusText.value.includes('成功')) {
    return 'success';
  }
  if (statusText.value.includes('失败')) {
    return 'error';
  }
  return 'pending';
});
const isSaving = ref(false);

const setApiPort = (nextPort) => {
  apiPort.value = nextPort;
  localStorage.setItem('backend_port', String(nextPort));
};

const fetchConfig = async (origin) => {
  const resp = await fetch(`${origin}/config`);
  if (!resp.ok) {
    throw new Error('加载失败');
  }
  const data = await resp.json();
  return { origin, data };
};

const applyConfig = (data) => {
  form.STREAMLINK_CMD = data.STREAMLINK_CMD || '';
  form.httpProxy = data.httpProxy || '';
  form.port = data.port || DEFAULT_PORT;
};

const loadConfig = async () => {
  try {
    const { data } = await fetchConfig(apiOrigin.value);
    applyConfig(data);
    statusText.value = '配置加载成功';
    return;
  } catch (error) {
    if (apiPort.value !== DEFAULT_PORT) {
      try {
        const fallbackOrigin = `http://127.0.0.1:${DEFAULT_PORT}`;
        const { data } = await fetchConfig(fallbackOrigin);
        setApiPort(DEFAULT_PORT);
        applyConfig(data);
        statusText.value = '配置加载成功';
        return;
      } catch (fallbackError) {
        console.error(fallbackError);
      }
    }
    statusText.value = '连接失败，请确认后端已启动';
    console.error(error);
  }
};

const pollBackend = async (origin, timeoutMs = 10000, intervalMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await fetch(`${origin}/config`, { cache: 'no-store' });
      if (resp.ok) {
        return true;
      }
    } catch (error) {
      // ignore during polling
    }

    if (Date.now() >= deadline) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const saveConfig = async () => {
  isSaving.value = true;
  try {
    const resp = await fetch(`${apiOrigin.value}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        STREAMLINK_CMD: form.STREAMLINK_CMD,
        httpProxy: form.httpProxy,
        port: form.port
      })
    });
    if (!resp.ok) {
      throw new Error('保存失败');
    }

    const restartResp = await fetch(`${apiOrigin.value}/restart`, { method: 'POST' });
    if (!restartResp.ok) {
      throw new Error('重启请求失败');
    }

    statusText.value = '保存成功，后端重启中...';
    setApiPort(form.port);

    const nextOrigin = `http://127.0.0.1:${form.port}`;
    const ok = await pollBackend(nextOrigin, 12000, 600);
    if (ok) {
      await loadConfig();
    } else {
      statusText.value = '重启超时，请确认后端已重新启动';
    }
  } catch (error) {
    statusText.value = error?.message || '保存失败';
    console.error(error);
  } finally {
    isSaving.value = false;
  }
};

const pickStreamlink = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.exe';
  input.onchange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      form.STREAMLINK_CMD = input.value || file.name;
      statusText.value = '已选择文件，请保存';
    }
  };
  input.click();
};

onMounted(loadConfig);
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 16px;
  padding: 48px;
  color: #1f2937;
  background: #f8fafc;
}

.title {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
}

.status {
  margin: 0;
  font-size: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #e2e8f0;
}

.status.success {
  background: #dcfce7;
  color: #15803d;
}

.status.error {
  background: #fee2e2;
  color: #b91c1c;
}

.status.pending {
  background: #e2e8f0;
  color: #1f2937;
}

.card {
  width: min(560px, 100%);
  background: #ffffff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.label {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #cbd5f5;
  font-size: 14px;
  color: #0f172a;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  border: none;
  background: #2563eb;
  color: #ffffff;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}

.btn.secondary {
  background: #0f172a;
}

.btn.ghost {
  background: transparent;
  color: #2563eb;
  border: 1px solid #bfdbfe;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
