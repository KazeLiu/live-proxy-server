<template>
  <div class="m3u-page">
    <section class="panel">
      <div class="panel-header">
        <h1>生成 m3u</h1>
        <p>输入 YouTube 或 Bilibili 直播链接，生成可播放的 m3u 列表。</p>
      </div>

      <div class="form-row">
        <input
          class="input"
          v-model.trim="inputUrl"
          placeholder="输入完整的直播地址或 YouTube UP 主"
          @keyup.enter="resolveInfo"
        />
        <button class="btn" :disabled="isResolving" @click="resolveInfo">
          {{ isResolving ? '识别中...' : '确认' }}
        </button>
      </div>

      <div class="result" v-if="preview">
        <div class="meta">
          <img class="cover" :src="preview.cover" alt="cover" />
          <h3>{{ preview.title }}</h3>
          <p>{{ preview.author || '未知主播' }}</p>
          <button class="btn-outline" @click="addToList">加入 m3u</button>
        </div>
      </div>

      <div class="hint" v-else>
        <span v-if="errorText">{{ errorText }}</span>
        <span v-else>请输入直播链接后点击确认</span>
      </div>
    </section>

    <section class="panel list-panel">
      <div class="panel-header">
        <h2>已添加</h2>
        <p>将这些直播输出为 m3u 文件。</p>
      </div>

      <div class="subscription-box">
        <div class="subscription-label">订阅地址</div>
        <div class="subscription-row">
          <input class="input" readonly :value="subscriptionUrl" />
          <button class="btn-outline" @click="copySubscription">复制</button>
        </div>
        <div class="subscription-hint">支持播放器直接订阅，列表变更会自动更新。</div>
      </div>

      <div class="view-toolbar">
        <div class="view-switch">
          <button
            class="view-switch-btn"
            :class="{ active: activeView === 'info' }"
            @click="activeView = 'info'"
          >
            直播信息视图
          </button>
          <button
            class="view-switch-btn"
            :class="{ active: activeView === 'm3u' }"
            @click="activeView = 'm3u'"
          >
            m3u 内容视图
          </button>
        </div>
        <button class="btn" :disabled="!items.length || isBatchRefreshing" @click="refreshAllItems">
          {{ isBatchRefreshing ? '批量刷新中...' : '批量刷新直播信息' }}
        </button>
      </div>

      <div class="auto-refresh-hint">已启用定时刷新：每 3 小时自动重新解析一次直播信息。</div>

      <template v-if="activeView === 'info'">
        <div v-if="items.length" class="list">
          <div class="list-item" v-for="item in items" :key="item.id">
            <img class="thumb" :src="item.cover" alt="cover" />
            <div class="detail">
              <div class="name-row">
                <div class="name">{{ item.title }}</div>
                <span v-if="item.isRefreshing" class="status-tag">刷新中</span>
              </div>
              <div class="sub">{{ item.author || '未知主播' }} · {{ item.platformLabel }}</div>
              <div class="sub" v-if="item.lastRefreshedAt">上次刷新：{{ formatRefreshTime(item.lastRefreshedAt) }}</div>
            </div>
            <div class="item-actions">
              <button class="btn-text btn-text-primary" @click="refreshItem(item)" :disabled="item.isRefreshing">
                {{ item.isRefreshing ? '刷新中...' : '刷新' }}
              </button>
              <button class="btn-text" @click="removeItem(item.id)">移除</button>
            </div>
          </div>
        </div>
        <div v-else class="empty">还没有添加任何直播</div>
      </template>

      <template v-else>
        <div class="export export-full">
          <textarea class="textarea" readonly :value="m3uContent"></textarea>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  getApiOrigin,
  getDefaultHost,
  getDefaultPort,
  getSubscriptionOrigin,
  resolveInitialBackendPort,
  resolveInitialSubscriptionHost
} from '../utils/apiConfig.js';

const DEFAULT_PORT = getDefaultPort();
const DEFAULT_HOST = getDefaultHost();
const AUTO_REFRESH_INTERVAL = 3 * 60 * 60 * 1000;

const apiPort = ref(DEFAULT_PORT);
const subscriptionHost = ref(DEFAULT_HOST);
const apiOrigin = computed(() => getApiOrigin(apiPort.value));
const subscriptionOrigin = computed(() => getSubscriptionOrigin(subscriptionHost.value, apiPort.value));
const subscriptionUrl = computed(() => `${subscriptionOrigin.value}/subscription.m3u`);

const inputUrl = ref('');
const isResolving = ref(false);
const isBatchRefreshing = ref(false);
const errorText = ref('');
const preview = ref(null);
const items = ref([]);
const activeView = ref('info');
let isHydrating = true;
let autoRefreshTimer = null;
let autoRefreshChannelTimer = null;

const platformLabels = {
  youtube: 'YouTube',
  bilibili: 'Bilibili'
};

const buildSourceUrlByPlatform = (platform, id) => {
  if (!platform || !id) {
    return '';
  }

  if (platform === 'youtube') {
    return `https://www.youtube.com/live/${id}`;
  }

  if (platform === 'bilibili') {
    return `https://live.bilibili.com/${id}`;
  }

  return '';
};

const buildItemFromLiveInfo = (data, fallbackItem = {}) => {
  // 统一直播信息结构，保证展示字段一致。
  const coverUrl = data.cover || fallbackItem.rawCover || '';
  const isBilibili = data.platform === 'bilibili' && coverUrl;
  const sourceUrl = data.sourceUrl || fallbackItem.sourceUrl || buildSourceUrlByPlatform(data.platform, data.id);

  return {
    id: `${data.platform}-${data.id}`,
    title: data.title || fallbackItem.title || '未知标题',
    author: data.author || fallbackItem.author || '',
    cover: isBilibili
      ? `${apiOrigin.value}/image?url=${encodeURIComponent(coverUrl)}`
      : coverUrl,
    rawCover: coverUrl,
    platform: data.platform,
    platformLabel: platformLabels[data.platform] || data.platform,
    streamUrl: `${apiOrigin.value}/live/${data.platform}/${data.id}`,
    sourceUrl,
    isRefreshing: false,
    lastRefreshedAt: new Date().toISOString()
  };
};

const fetchLiveInfo = async (url) => {
  // 统一的直播信息解析入口（视频级别）。
  const resp = await fetch(`${apiOrigin.value}/live-info?url=${encodeURIComponent(url)}`);
  if (!resp.ok) {
    throw new Error('解析失败');
  }
  return resp.json();
};

const isYouTubeChannelInput = (value) => {
  // 判断用户是否输入了 YouTube UP 主/频道信息，用于走频道解析分支。
  const raw = String(value || '').trim();
  if (!raw) return false;

  if (raw.startsWith('@')) return true;

  try {
    const url = new URL(raw);
    if (!url.hostname.includes('youtube.com')) return false;
    return ['/@', '/channel/', '/user/', '/c/'].some((prefix) => url.pathname.startsWith(prefix));
  } catch (error) {
    return false;
  }
};

const addYouTubeChannel = async (channel) => {
  // 由后端解析频道并落入 m3u，前端只需刷新列表。
  const resp = await fetch(`${apiOrigin.value}/subscription/youtube-channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel })
  });
  if (!resp.ok) {
    throw new Error('添加频道失败');
  }
  return resp.json();
};

const refreshYouTubeChannels = async () => {
  // 通知后端刷新所有频道来源条目，并更新 m3u。
  const resp = await fetch(`${apiOrigin.value}/subscription/youtube-channel/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!resp.ok) {
    throw new Error('刷新频道失败');
  }
  return resp.json();
};

const resolveInfo = async () => {
  // 根据输入类型决定走「视频解析」还是「频道订阅」流程。
  if (!inputUrl.value) {
    errorText.value = '请先输入直播地址';
    return;
  }
  isResolving.value = true;
  errorText.value = '';
  preview.value = null;
  try {
    if (isYouTubeChannelInput(inputUrl.value)) {
      await addYouTubeChannel(inputUrl.value);
      await loadSubscription();
      inputUrl.value = '';
      errorText.value = '已添加 YouTube UP 主订阅';
      return;
    }

    const data = await fetchLiveInfo(inputUrl.value);
    preview.value = buildItemFromLiveInfo(data);
  } catch (error) {
    errorText.value = '解析失败，请确认链接可用';
  } finally {
    isResolving.value = false;
  }
};

const addToList = () => {
  if (!preview.value) return;
  if (items.value.some((item) => item.id === preview.value.id)) {
    errorText.value = '该直播已在列表中';
    return;
  }
  items.value.push({ ...preview.value });
  preview.value = null;
  inputUrl.value = '';
  activeView.value = 'info';
};

const removeItem = (id) => {
  items.value = items.value.filter((item) => item.id !== id);
};

const refreshItem = async (item) => {
  // 单条刷新沿用视频解析逻辑，保证入口一致。
  if (!item || item.isRefreshing) {
    return;
  }

  const sourceUrl = buildSourceUrlByPlatform(item.platform, item.id?.split('-').slice(1).join('-') || '');
  if (!sourceUrl) {
    return;
  }

  item.isRefreshing = true;
  try {
    const data = await fetchLiveInfo(sourceUrl);
    const nextItem = buildItemFromLiveInfo(data, item);
    Object.assign(item, nextItem);
  } catch (error) {
    console.error('刷新直播信息失败', error);
  } finally {
    item.isRefreshing = false;
  }
};

const refreshAllItems = async () => {
  // 批量刷新时先更新频道来源条目，再刷新单条直播信息。
  if (!items.value.length || isBatchRefreshing.value) {
    return;
  }

  isBatchRefreshing.value = true;
  try {
    await refreshChannelSubscriptions();
    for (const item of items.value) {
      await refreshItem(item);
    }
  } finally {
    isBatchRefreshing.value = false;
  }
};

const refreshChannelSubscriptions = async () => {
  // 专门刷新 UP 主来源条目，并重建对应的直播列表。
  try {
    await refreshYouTubeChannels();
    await loadSubscription();
  } catch (error) {
    console.error('刷新频道订阅失败', error);
  }
};

const formatRefreshTime = (time) => {
  if (!time) return '未知';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return '未知';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
};

const parseAttributes = (text) => {
  const attrs = {};
  const regex = /([\w-]+)="(.*?)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const parseM3u = (content) => {
  // 解析 m3u 内容为前端条目，保留频道来源信息。
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const parsed = [];
  let pendingMeta = '';

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      pendingMeta = line;
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }
    if (!line) continue;

    const metaText = pendingMeta || '';
    const attrText = metaText.includes(' ') ? metaText.slice(metaText.indexOf(' ') + 1) : '';
    const displayName = metaText.includes(',') ? metaText.split(',').slice(1).join(',').trim() : '';
    const attrs = parseAttributes(attrText);
    const streamUrl = line;

    let platform = '';
    let id = '';
    const match = streamUrl.match(/\/live\/([^/]+)\/([^/?#]+)/);
    if (match) {
      platform = match[1];
      id = match[2];
    }

    const platformLabel = platformLabels[platform] || platform || '直播';
    const itemId = platform && id ? `${platform}-${id}` : `custom-${parsed.length + 1}`;

    parsed.push({
      id: itemId,
      title: displayName || attrs['tvg-name'] || platformLabel,
      author: attrs['tvg-name'] || '',
      cover: attrs['tvg-logo'] || '',
      rawCover: attrs['tvg-logo'] || '',
      platform,
      platformLabel,
      streamUrl,
      sourceUrl: buildSourceUrlByPlatform(platform, id),
      sourceType: attrs['x-source'] || '',
      channelKey: attrs['x-channel-key'] || '',
      channelName: attrs['x-channel-name'] || '',
      channelUrl: attrs['x-channel-url'] || '',
      isRefreshing: false,
      lastRefreshedAt: ''
    });
    pendingMeta = '';
  }

  return parsed;
};

const m3uContent = computed(() => {
  // 生成 m3u 内容并带上频道来源元数据。
  if (!items.value.length) {
    return '#EXTM3U';
  }
  return [
    '#EXTM3U',
    ...items.value.map((item) => {
      const displayName = item.title || item.author || item.platformLabel;
      const author = item.author || '';
      const extraAttrs = [];

      if (item.sourceType) {
        extraAttrs.push(`x-source="${item.sourceType}"`);
      }
      if (item.channelKey) {
        extraAttrs.push(`x-channel-key="${item.channelKey}"`);
      }
      if (item.channelName) {
        extraAttrs.push(`x-channel-name="${item.channelName}"`);
      }
      if (item.channelUrl) {
        extraAttrs.push(`x-channel-url="${item.channelUrl}"`);
      }

      const meta = `#EXTINF:-1 tvg-logo="${item.cover}" tvg-name="${author}" group-title="Live" ${extraAttrs.join(' ')},${displayName}`;
      return `${meta}\n${item.streamUrl}`;
    })
  ].join('\n');
});

const saveSubscription = async () => {
  try {
    await fetch(`${apiOrigin.value}/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: m3uContent.value })
    });
  } catch (error) {
    console.error('保存订阅失败', error);
  }
};

const loadSubscription = async () => {
  // 同步后端订阅内容到前端列表。
  try {
    const resp = await fetch(subscriptionUrl.value, { cache: 'no-store' });
    if (!resp.ok) {
      isHydrating = false;
      return;
    }
    const text = await resp.text();
    const parsed = parseM3u(text);
    items.value = parsed;
  } catch (error) {
    console.error('加载订阅失败', error);
  } finally {
    isHydrating = false;
  }
};

const copySubscription = async () => {
  try {
    await navigator.clipboard.writeText(subscriptionUrl.value);
    errorText.value = '订阅地址已复制';
  } catch (error) {
    errorText.value = '复制失败，请手动选择';
  }
};

watch(
  items,
  () => {
    if (isHydrating) return;
    saveSubscription();
  },
  { deep: true }
);

onMounted(async () => {
  // 初始化订阅列表，并开启定时刷新。
  const [initialPort, initialHost] = await Promise.all([
    resolveInitialBackendPort(),
    resolveInitialSubscriptionHost()
  ]);
  apiPort.value = initialPort;
  subscriptionHost.value = initialHost || DEFAULT_HOST;
  await loadSubscription();
  autoRefreshTimer = window.setInterval(() => {
    refreshAllItems();
  }, AUTO_REFRESH_INTERVAL);
  autoRefreshChannelTimer = window.setInterval(() => {
    refreshChannelSubscriptions();
  }, AUTO_REFRESH_INTERVAL);
});

onBeforeUnmount(() => {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (autoRefreshChannelTimer) {
    window.clearInterval(autoRefreshChannelTimer);
    autoRefreshChannelTimer = null;
  }
});
</script>

<style scoped>
.m3u-page {
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  align-items: start;
}

.panel {
  background: #ffffff;
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
  border: 1px solid #eef2f7;
}

.panel-header h1,
.panel-header h2 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #0f172a;
}

.panel-header p {
  margin: 0;
  color: #64748b;
  font-size: 14px;
}

.form-row {
  margin-top: 20px;
  display: flex;
  gap: 12px;
}

.input {
  flex: 1;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  font-size: 14px;
}

.btn {
  padding: 12px 18px;
  border: none;
  border-radius: 12px;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-outline {
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
}

.result {
  margin-top: 20px;
  display: block;
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.preview-actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.cover {
  width: 100%;
  object-fit: cover;
  border-radius: 12px;
  background: #e2e8f0;
}

.meta h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.meta p {
  margin: 0 0 6px;
  color: #64748b;
  font-size: 13px;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 12px;
}

.hint {
  margin-top: 16px;
  color: #ef4444;
  font-size: 13px;
}

.list-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.subscription-box {
  background: #f8fafc;
  border: 1px dashed #cbd5f5;
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subscription-label {
  font-size: 12px;
  color: #475569;
  font-weight: 600;
}

.subscription-row {
  display: flex;
  gap: 10px;
}

.subscription-hint {
  font-size: 12px;
  color: #94a3b8;
}

.view-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.view-switch {
  display: inline-flex;
  width: fit-content;
  padding: 4px;
  border-radius: 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.view-switch-btn {
  border: none;
  background: transparent;
  color: #1e40af;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
}

.view-switch-btn.active {
  background: #2563eb;
  color: #ffffff;
}

.auto-refresh-hint {
  font-size: 12px;
  color: #64748b;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 320px;
  overflow: auto;
}

.list-item {
  display: flex;
  gap: 12px;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
}

.thumb {
  width: 64px;
  height: 42px;
  border-radius: 10px;
  object-fit: cover;
}

.detail {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.sub {
  font-size: 12px;
  color: #64748b;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  color: #1d4ed8;
  background: #dbeafe;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-text {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 13px;
}

.btn-text:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-text-primary {
  color: #2563eb;
}

.empty {
  font-size: 13px;
  color: #94a3b8;
}

.export {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: start;
  margin-top: 8px;
}

.export-full {
  grid-template-columns: 1fr;
  margin-top: 0;
}

.export .btn {
  align-self: start;
}

.textarea {
  width: 100%;
  min-height: 320px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 12px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  background: #f8fafc;
}

@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
  }

  .subscription-row,
  .view-toolbar,
  .item-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .result {
    flex-direction: column;
    align-items: flex-start;
  }

  .list-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .view-switch {
    width: 100%;
  }

  .view-switch-btn {
    flex: 1;
  }
}
</style>
