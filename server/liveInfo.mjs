const parseLiveUrl = (input) => {
  if (!input) return null;
  let url;
  try {
    url = new URL(input);
  } catch (error) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
    let id = '';
    if (hostname === 'youtu.be') {
      id = url.pathname.replace('/', '');
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') || '';
    } else if (url.pathname.startsWith('/live/')) {
      id = url.pathname.split('/')[2] || '';
    }
    if (!id) return null;
    return { platform: 'youtube', id, sourceUrl: url.toString() };
  }

  if (hostname.includes('bilibili.com')) {
    const match = url.pathname.match(/\/live\/(\d+)/) || url.pathname.match(/\/(\d+)/);
    const id = match ? match[1] : '';
    if (!id) return null;
    return { platform: 'bilibili', id, sourceUrl: url.toString() };
  }

  return null;
};

import { ProxyAgent } from 'undici';

const buildDispatcher = (proxyUrl) => {
  if (!proxyUrl) return undefined;
  try {
    return new ProxyAgent(proxyUrl);
  } catch (error) {
    return undefined;
  }
};

const fetchBilibiliInfo = async (roomId, proxyUrl) => {
  const dispatcher = buildDispatcher(proxyUrl);
  const infoResp = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, {
    dispatcher
  });
  if (!infoResp.ok) {
    throw new Error('bilibili api failed');
  }
  const infoJson = await infoResp.json();
  if (infoJson.code !== 0) {
    throw new Error('bilibili api error');
  }
  const data = infoJson.data || {};
  let author = data.uname || '';
  if (!author) {
    try {
      const anchorResp = await fetch(`https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${roomId}`, {
        dispatcher
      });
      const anchorJson = await anchorResp.json();
      author = anchorJson?.data?.info?.uname || '';
    } catch (error) {
      author = '';
    }
  }
  return {
    title: data.title || 'Bilibili 直播间',
    author,
    cover: data.user_cover || data.keyframe || ''
  };
};

const fetchYouTubeInfo = async (sourceUrl, proxyUrl) => {
  const dispatcher = buildDispatcher(proxyUrl);
  const resp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`, {
    dispatcher
  });
  if (!resp.ok) {
    throw new Error('youtube oembed failed');
  }
  const data = await resp.json();
  return {
    title: data.title || 'YouTube Live',
    author: data.author_name || '',
    cover: data.thumbnail_url || ''
  };
};

const resolveLiveInfo = async (inputUrl, options = {}) => {
  const parsed = parseLiveUrl(inputUrl);
  if (!parsed) {
    const error = new Error('invalid url');
    error.statusCode = 400;
    throw error;
  }

  const proxyUrl = options.httpProxy || '';

  let detail;
  if (parsed.platform === 'youtube') {
    detail = await fetchYouTubeInfo(parsed.sourceUrl, proxyUrl);
  } else if (parsed.platform === 'bilibili') {
    detail = await fetchBilibiliInfo(parsed.id, proxyUrl);
  } else {
    const error = new Error('unsupported platform');
    error.statusCode = 400;
    throw error;
  }

  return {
    platform: parsed.platform,
    id: parsed.id,
    sourceUrl: parsed.sourceUrl,
    ...detail
  };
};

export { resolveLiveInfo };
