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
          <div class="toggle-row">
            <div>
              <label class="label toggle-label">启用代理</label>
              <p class="hint toggle-hint">关闭后将不再使用 HTTP 代理，直播请求改为直连</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: form.proxyEnabled }"
              type="button"
              @click="form.proxyEnabled = !form.proxyEnabled"
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">HTTP 代理</label>
          <input
            class="styled-input"
            type="text"
            v-model="form.httpProxy"
            placeholder="http://127.0.0.1:7897"
            :disabled="!form.proxyEnabled"
          />
          <p class="hint" v-if="!form.proxyEnabled">当前已关闭代理，此地址不会被使用</p>
        </div>

        <div class="form-group">
          <label class="label">服务端口</label>
          <input
            class="styled-input"
            type="number"
            v-model.number="form.port"
            placeholder="8900"
          />
        </div>

        <div class="divider"></div>

        <div class="form-group">
          <label class="label">m3u 导入导出</label>
          <div class="action-footer">
            <button class="btn-secondary" type="button" @click="exportM3uFile">导出当前 m3u 文件</button>
            <div class="import-card">
              <div class="input-row">
                <input
                  class="styled-input"
                  type="text"
                  :value="importFileName"
                  placeholder="请选择 .m3u 文件"
                  readonly
                />
                <button class="btn-icon" type="button" @click="pickImportFile" title="选择 m3u 文件">
                  <span class="icon">📂</span>
                </button>
              </div>
              <input
                class="styled-input"
                type="number"
                v-model.number="importPort"
                placeholder="导入时同时修改端口"
              />
              <button class="btn-secondary" type="button" :disabled="isImporting" @click="importM3uFile">
                <span v-if="isImporting" class="loader loader-dark"></span>
                {{ isImporting ? '导入中...' : '导入 m3u 并应用端口' }}
              </button>
              <p class="hint">导入后会覆盖当前订阅内容，并同步更新服务端口。</p>
            </div>
          </div>
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
import {
  createInitialConfig,
  getApiOrigin,
  getDefaultPort,
  resolveInitialBackendPort,
  setStoredBackendPort,
  updateCachedAppConfig
} from '../utils/apiConfig.js';

const DEFAULT_PORT = getDefaultPort();
const REQUEST_TIMEOUT_MS = 2500;
const apiPort = ref(DEFAULT_PORT);
const apiOrigin = computed(() => getApiOrigin(apiPort.value));

const form = reactive({
  STREAMLINK_CMD: '',
  httpProxy: '',
  proxyEnabled: true,
  port: DEFAULT_PORT
});

const statusText = ref('正在初始化...');
const statusClass = computed(() => {
  if (statusText.value.includes('成功')) {
    return 'success';
  }
  if (statusText.value.includes('失败') || statusText.value.includes('超时')) {
    return 'error';
  }
  return 'pending';
});
const isSaving = ref(false);
const isImporting = ref(false);
const importFile = ref(null);
const importFileName = ref('');
const importPort = ref(DEFAULT_PORT);

const setApiPort = (nextPort) => {
  apiPort.value = nextPort;
  setStoredBackendPort(nextPort);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
};

const fetchConfig = async (origin, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const resp = await fetchWithTimeout(`${origin}/config`, { cache: 'no-store' }, timeoutMs);
  if (!resp.ok) {
    throw new Error('加载失败');
  }
  const data = await resp.json();
  return { origin, data };
};

const applyConfig = (data) => {
  const normalized = updateCachedAppConfig(data);
  form.STREAMLINK_CMD = normalized.STREAMLINK_CMD;
  form.httpProxy = normalized.httpProxy;
  form.proxyEnabled = normalized.proxyEnabled;
  form.port = normalized.port;
};

const loadConfig = async () => {
  const originsToTry = [apiOrigin.value];
  const fallbackOrigin = `http://127.0.0.1:${DEFAULT_PORT}`;
  if (apiOrigin.value !== fallbackOrigin) {
    originsToTry.push(fallbackOrigin);
  }

  for (const origin of originsToTry) {
    try {
      const { data } = await fetchConfig(origin);
      if (origin !== apiOrigin.value) {
        setApiPort(DEFAULT_PORT);
      }
      applyConfig(data);
      statusText.value = '配置加载成功';
      return true;
    } catch (error) {
      console.error(`加载配置失败: ${origin}`, error);
    }
  }

  statusText.value = '连接失败，请确认后端已启动';
  return false;
};

const pollBackend = async (origin, timeoutMs = 10000, intervalMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await fetchWithTimeout(`${origin}/config`, { cache: 'no-store' }, Math.min(intervalMs, 1500));
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

const replaceSubscriptionPort = async (origin) => {
  try {
    const resp = await fetchWithTimeout(`${origin}/subscription.m3u`, { cache: 'no-store' });
    if (!resp.ok) return;
    const text = await resp.text();
    const updated = text
      .replace(/http:\/\/127\.0\.0\.1:\d+/g, origin)
      .replace(/http:\/\/localhost:\d+/g, origin);
    if (updated === text) return;
    await fetchWithTimeout(`${origin}/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: updated })
    }, 4000);
  } catch (error) {
    console.error('同步订阅端口失败', error);
  }
};

const triggerRestart = async (targetOrigin, nextPort, successMessage = '保存成功，后端重启中...') => {
  const restartResp = await fetchWithTimeout(`${targetOrigin}/restart`, { method: 'POST' }, 4000);
  if (!restartResp.ok) {
    throw new Error('重启请求失败');
  }

  statusText.value = successMessage;
  setApiPort(nextPort);

  const nextOrigin = `http://127.0.0.1:${nextPort}`;
  const ok = await pollBackend(nextOrigin, 12000, 600);
  if (ok) {
    await replaceSubscriptionPort(nextOrigin);
    window.location.reload();
    return true;
  }

  statusText.value = '重启超时，请确认后端已重新启动';
  return false;
};

const saveConfig = async () => {
  isSaving.value = true;
  try {
    const resp = await fetchWithTimeout(`${apiOrigin.value}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        STREAMLINK_CMD: form.STREAMLINK_CMD,
        httpProxy: form.httpProxy,
        proxyEnabled: form.proxyEnabled,
        port: form.port
      })
    }, 4000);
    if (!resp.ok) {
      throw new Error('保存失败');
    }

    await triggerRestart(apiOrigin.value, form.port, '保存成功，后端重启中...');
  } catch (error) {
    statusText.value = error?.message || '保存失败';
    console.error(error);
  } finally {
    isSaving.value = false;
  }
};

const exportM3uFile = () => {
  window.open(`${apiOrigin.value}/subscription/export`, '_blank', 'noopener');
};

const pickImportFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.m3u,.m3u8,audio/x-mpegurl';
  input.onchange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      importFile.value = file;
      importFileName.value = file.name;
      statusText.value = '已选择 m3u 文件，请点击导入';
    }
  };
  input.click();
};

const importM3uFile = async () => {
  if (!importFile.value) {
    statusText.value = '请先选择要导入的 m3u 文件';
    return;
  }

  const nextPort = Number(importPort.value);
  if (!Number.isFinite(nextPort) || nextPort <= 0) {
    statusText.value = '请输入有效的导入端口';
    return;
  }

  isImporting.value = true;
  try {
    const content = await importFile.value.text();
    const resp = await fetchWithTimeout(`${apiOrigin.value}/subscription/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content,
        port: nextPort
      })
    }, 6000);

    if (!resp.ok) {
      throw new Error('导入失败');
    }

    form.port = nextPort;
    updateCachedAppConfig({ port: nextPort });
    await triggerRestart(apiOrigin.value, nextPort, '导入成功，后端重启中...');
  } catch (error) {
    statusText.value = error?.message || '导入失败';
    console.error(error);
  } finally {
    isImporting.value = false;
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

onMounted(async () => {
  try {
    const initialConfig = await createInitialConfig();
    Object.assign(form, initialConfig);
    importPort.value = initialConfig.port;
    statusText.value = '正在连接后端...';
  } catch (error) {
    console.error('加载本地配置失败:', error);
    statusText.value = '本地配置加载失败，已使用默认值';
  }

  try {
    setApiPort(await resolveInitialBackendPort());
    await loadConfig();
  } catch (error) {
    console.error('初始化配置失败:', error);
    statusText.value = '页面初始化失败';
  }
});
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

.import-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px dashed #dbe4ff;
  border-radius: 16px;
  background: #f8fbff;
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
 
 .toggle-row {
   display: flex;
   align-items: center;
   justify-content: space-between;
   gap: 16px;
 }
 
 .toggle-label {
   margin-bottom: 4px;
 }
 
 .toggle-hint {
   margin: 0;
 }
 
 .toggle-switch {
   position: relative;
   width: 54px;
   height: 32px;
   border: none;
   border-radius: 999px;
   background: #ced4da;
   cursor: pointer;
   transition: background 0.2s ease;
   flex-shrink: 0;
 }
 
 .toggle-switch.active {
   background: #228be6;
 }
 
 .toggle-thumb {
   position: absolute;
   top: 4px;
   left: 4px;
   width: 24px;
   height: 24px;
   border-radius: 50%;
   background: #fff;
   transition: transform 0.2s ease;
   box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
 }
 
 .toggle-switch.active .toggle-thumb {
   transform: translateX(22px);
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

.btn-secondary {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #cfe0ff;
  border-radius: 14px;
  background: #eef5ff;
  color: #1c5fd4;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.btn-primary:hover {
  background: #1a6ab3;
  transform: translateY(-1px);
}

.btn-secondary:hover {
  background: #dbe9ff;
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary:active {
  transform: translateY(0);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.loader-dark {
  border-color: #1c5fd4;
  border-bottom-color: transparent;
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
