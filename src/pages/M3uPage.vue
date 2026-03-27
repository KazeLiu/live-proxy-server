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
            placeholder="输入完整的直播地址"
            @keyup.enter="resolveInfo"
        />
        <button class="btn" :disabled="isResolving" @click="resolveInfo">
          {{ isResolving ? '识别中...' : '确认' }}
        </button>
      </div>

      <div class="result" v-if="preview">
        <div class="meta">
          <img class="cover" :src="preview.cover" alt="cover"/>
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
      <button class="btn" :disabled="!items.length" @click="exportM3u">导出 m3u</button>
      <div v-if="items.length" class="list">
        <div class="list-item" v-for="item in items" :key="item.id">
          <img class="thumb" :src="item.cover" alt="cover"/>
          <div class="detail">
            <div class="name">{{ item.title }}</div>
            <div class="sub">{{ item.author || '未知主播' }} · {{ item.platformLabel }}</div>
          </div>
          <button class="btn-text" @click="removeItem(item.id)">移除</button>
        </div>
      </div>
      <div v-else class="empty">还没有添加任何直播</div>

      <div class="export">
        <textarea class="textarea" readonly :value="m3uContent"></textarea>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const DEFAULT_PORT = 8900;
const apiPort = ref(Number(localStorage.getItem('backend_port')) || DEFAULT_PORT);
const apiOrigin = computed(() => `http://127.0.0.1:${apiPort.value}`);
const subscriptionUrl = computed(() => `${apiOrigin.value}/subscription.m3u`);

const inputUrl = ref('');
const isResolving = ref(false);
const errorText = ref('');
const preview = ref(null);
const items = ref([]);
let isHydrating = true;

const platformLabels = {
  youtube: 'YouTube',
  bilibili: 'Bilibili'
};

const resolveInfo = async () => {
  if (!inputUrl.value) {
    errorText.value = '请先输入直播地址';
    return;
  }
  isResolving.value = true;
  errorText.value = '';
  preview.value = null;
  try {
    const resp = await fetch(`${apiOrigin.value}/live-info?url=${encodeURIComponent(inputUrl.value)}`);
    if (!resp.ok) {
      throw new Error('解析失败');
    }
    const data = await resp.json();
    const coverUrl = data.cover || '';
    const isBilibili = data.platform === 'bilibili' && coverUrl;
    preview.value = {
      id: `${data.platform}-${data.id}`,
      title: data.title || '未知标题',
      author: data.author || '',
      cover: isBilibili
          ? `${apiOrigin.value}/image?url=${encodeURIComponent(coverUrl)}`
          : coverUrl,
      platform: data.platform,
      platformLabel: platformLabels[data.platform] || data.platform,
      streamUrl: `${apiOrigin.value}/live/${data.platform}/${data.id}`,
      sourceUrl: data.sourceUrl
    };
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
  items.value.push({...preview.value});
  preview.value = null;
  inputUrl.value = '';
};

const removeItem = (id) => {
  items.value = items.value.filter((item) => item.id !== id);
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
      platform,
      platformLabel,
      streamUrl,
      sourceUrl: ''
    });
    pendingMeta = '';
  }

  return parsed;
};

const m3uContent = computed(() => {
  if (!items.value.length) {
    return '#EXTM3U';
  }
  return [
    '#EXTM3U',
    ...items.value.map((item) => {
      const displayName = item.title || item.author || item.platformLabel;
      const author = item.author || '';
      const meta = `#EXTINF:-1 tvg-logo="${item.cover}" tvg-name="${author}" group-title="Live",${displayName}`;
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

const exportM3u = () => {
  const blob = new Blob([m3uContent.value], {type: 'audio/x-mpegurl'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-${Date.now()}.m3u`;
  a.click();
  URL.revokeObjectURL(url);
};

watch(
  items,
  () => {
    if (isHydrating) return;
    saveSubscription();
  },
  { deep: true }
);

onMounted(loadSubscription);
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

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.sub {
  font-size: 12px;
  color: #64748b;
}

.btn-text {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 13px;
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

  .export .btn {
    align-self: start;
  }

  .textarea {
    width: 100%;
    min-height: 160px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 12px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    background: #f8fafc;
  }

  .list {
    max-height: 320px;
    overflow: auto;
  }


@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
  }

  .subscription-row {
    flex-direction: column;
  }

  .result {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
