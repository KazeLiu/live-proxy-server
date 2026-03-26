<template>
  <main class="page-container">
    <div class="content-wrapper">
      <header class="header-section">
        <h1 class="title">系统设置</h1>
        <div class="status-badge" :class="statusClass">
          <span class="dot"></span>
          {{ statusText }}
        </div>
      </header>

      <section class="settings-card">
        <div class="form-group">
          <label class="label">Streamlink 路径</label>
          <div class="input-row">
            <input
              class="styled-input"
              type="text"
              v-model="form.STREAMLINK_CMD"
              placeholder="例如：C:\Program Files\Streamlink\bin\streamlink.exe"
            />
            <button class="btn-icon" @click="pickStreamlink" title="浏览文件">
              <span class="icon">📂</span>
            </button>
          </div>
          <p class="hint">请指向 Streamlink 的可执行文件位置</p>
        </div>

        <div class="form-group">
          <label class="label">HTTP 代理</label>
          <input
            class="styled-input"
            type="text"
            v-model="form.httpProxy"
            placeholder="http://127.0.0.1:7897"
          />
        </div>

        <div class="form-group">
          <label class="label">服务端口</label>
          <input
            class="styled-input"
            type="number"
            v-model.number="form.port"
            placeholder="8899"
          />
        </div>

        <div class="divider"></div>

        <div class="action-footer">
          <button class="btn-primary" :disabled="isSaving" @click="saveConfig">
            <span v-if="isSaving" class="loader"></span>
            {{ isSaving ? '应用中...' : '保存并重启服务' }}
          </button>
          <button class="btn-text" @click="loadConfig">撤销修改</button>
        </div>
      </section>
    </div>
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
.page-container {
  min-height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px;
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

.content-wrapper {
  width: 100%;
  max-width: 520px;
  animation: fadeIn 0.6s ease-out;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 0 8px;
}

.title {
  font-size: 24px;
  color: #1a1c1e;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.5px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-badge.pending { background: #f1f3f5; color: #6c757d; }
.status-badge.pending .dot { background: #6c757d; }

.status-badge.success { background: #e7f5ff; color: #228be6; }
.status-badge.success .dot { background: #228be6; box-shadow: 0 0 8px #228be6; }

.status-badge.error { background: #fff5f5; color: #fa5252; }
.status-badge.error .dot { background: #fa5252; }

.settings-card {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.04);
}

.form-group {
  margin-bottom: 20px;
}

.label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #495057;
  margin-bottom: 8px;
  margin-left: 4px;
}

.styled-input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1.5px solid #e9ecef;
  background: #fff;
  font-size: 14px;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.styled-input:focus {
  outline: none;
  border-color: #4dabf7;
  box-shadow: 0 0 0 4px rgba(77, 171, 247, 0.1);
}

.input-row {
  display: flex;
  gap: 10px;
}

.hint {
  font-size: 12px;
  color: #adb5bd;
  margin: 6px 0 0 4px;
}

.divider {
  height: 1px;
  background: #f1f3f5;
  margin: 24px 0;
}

.action-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-primary {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: #1c7ed6;
  color: white;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.btn-primary:hover {
  background: #1a6ab3;
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-icon {
  padding: 0 16px;
  border-radius: 12px;
  border: 1.5px solid #e9ecef;
  background: #f8fafc;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #e9ecef;
}

.btn-text {
  background: none;
  border: none;
  color: #868e96;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 4px;
}

.btn-text:hover {
  color: #495057;
}

.loader {
  width: 16px;
  height: 16px;
  border: 2px solid #ffffff;
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: rotation 1s linear infinite;
}

@keyframes rotation {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
