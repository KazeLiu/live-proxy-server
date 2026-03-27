import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent } from 'undici';
import { resolveLiveInfo } from './liveInfo.mjs';
import { readCookieContent, writeCookieContent } from './cookies.mjs';
import { streamLive } from './streamlink.mjs';

const LOG_BUFFER_LIMIT = 500;
const logBuffer = [];
const logSubscribers = new Set();

const serializeLogArg = (value) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const pushLogEntry = (level, message) => {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString()
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_LIMIT) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_LIMIT);
  }
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of logSubscribers) {
    try {
      res.write(payload);
    } catch (error) {
      logSubscribers.delete(res);
    }
  }
};

const patchConsole = () => {
  const levels = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const message = args.map(serializeLogArg).join(' ');
        pushLogEntry(level, message);
      } catch (error) {
        pushLogEntry('error', `Failed to serialize log: ${error?.message || error}`);
      }
      original(...args);
    };
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, 'config.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const SUBSCRIPTION_FILE = path.join(OUTPUT_DIR, 'live.m3u');

const DEFAULT_CONFIG = {
  port:8900,
  STREAMLINK_CMD: 'C:\\Program Files\\Streamlink\\bin\\streamlink.exe',
  httpProxy: 'http://127.0.0.1:7897',
  proxyEnabled: true
};

const normalizeConfig = (input) => {
  const merged = { ...DEFAULT_CONFIG, ...(input || {}) };
  const port = Number(merged.port);

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_CONFIG.port,
    STREAMLINK_CMD: String(merged.STREAMLINK_CMD || DEFAULT_CONFIG.STREAMLINK_CMD),
    httpProxy: String(merged.httpProxy || DEFAULT_CONFIG.httpProxy),
    proxyEnabled: merged.proxyEnabled !== false
  };
};

const loadConfig = async () => {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const fallback = normalizeConfig();
      await fs.writeFile(CONFIG_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
      return fallback;
    }
    throw error;
  }
};

const saveConfig = async (payload) => {
  const nextConfig = normalizeConfig(payload);
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8');
  return nextConfig;
};

const ensureOutputDir = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
};

const readSubscription = async () => {
  try {
    return await fs.readFile(SUBSCRIPTION_FILE, 'utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '#EXTM3U';
    }
    throw error;
  }
};

const writeSubscription = async (content) => {
  await ensureOutputDir();
  const trimmed = String(content || '').trim();
  const payload = trimmed ? trimmed : '#EXTM3U';
  await fs.writeFile(SUBSCRIPTION_FILE, `${payload}\n`, 'utf-8');
  return payload;
};

const config = await loadConfig();

const app = express();
const PORT = config.port;
const STREAMLINK_CMD = config.STREAMLINK_CMD;
const httpProxy = config.proxyEnabled ? config.httpProxy : '';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

patchConsole();

app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write('retry: 1000\n\n');
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  logSubscribers.add(res);
  req.on('close', () => {
    logSubscribers.delete(res);
  });
});

app.get('/subscription.m3u', async (_req, res) => {
  try {
    const content = await readSubscription();
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  } catch (error) {
    console.error('Failed to load subscription:', error);
    res.status(500).json({ error: 'failed to load subscription' });
  }
});

app.post('/subscription', async (req, res) => {
  try {
    const content = String(req.body?.content || '');
    const payload = await writeSubscription(content);
    res.json({ ok: true, length: payload.length });
  } catch (error) {
    console.error('Failed to save subscription:', error);
    res.status(500).json({ error: 'failed to save subscription' });
  }
});

app.get('/config', async (_req, res) => {
  try {
    const currentConfig = await loadConfig();
    res.json(currentConfig);
  } catch (error) {
    console.error('Failed to load config:', error);
    res.status(500).json({ error: 'failed to load config' });
  }
});

app.post('/config', async (req, res) => {
  try {
    const nextConfig = await saveConfig(req.body);
    res.json(nextConfig);
  } catch (error) {
    console.error('Failed to save config:', error);
    res.status(500).json({ error: 'failed to save config' });
  }
});

app.post('/restart', (_req, res) => {
  res.json({ ok: true });

  const args = process.argv.slice(1);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });

  child.unref();

  setTimeout(() => process.exit(0), 200);
});

app.get('/live-info', async (req, res) => {
  try {
    const inputUrl = String(req.query.url || '').trim();
    const payload = await resolveLiveInfo(inputUrl, { httpProxy });
    res.json(payload);
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    const message = statusCode === 400 ? error.message : 'failed to resolve live info';
    if (statusCode !== 400) {
      console.error('Failed to resolve live info:', error);
    }
    res.status(statusCode).json({ error: message });
  }
});

app.get('/image', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) {
    res.status(400).json({ error: 'missing url' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.status(400).json({ error: 'invalid protocol' });
    return;
  }

  const dispatcher = httpProxy ? new ProxyAgent(httpProxy) : undefined;

  try {
    const resp = await fetch(parsed.toString(), {
      dispatcher,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://live.bilibili.com/'
      }
    });

    if (!resp.ok) {
      res.status(resp.status).end();
      return;
    }

    res.setHeader('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (resp.body) {
      const { Readable } = await import('stream');
      Readable.fromWeb(resp.body).pipe(res);
    } else {
      const buffer = Buffer.from(await resp.arrayBuffer());
      res.end(buffer);
    }
  } catch (error) {
    console.error('Failed to proxy image:', error);
    res.status(502).json({ error: 'failed to proxy image' });
  }
});

app.get('/cookies/:platform', async (req, res) => {
  try {
    const content = await readCookieContent(req.params.platform, OUTPUT_DIR);
    res.json({ platform: req.params.platform, content });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    if (statusCode !== 400) {
      console.error('Failed to load cookies:', error);
    }
    res.status(statusCode).json({ error: statusCode === 400 ? error.message : 'failed to load cookies' });
  }
});

app.post('/cookies/:platform', async (req, res) => {
  try {
    const content = String(req.body?.content || '');
    const result = await writeCookieContent(req.params.platform, content, OUTPUT_DIR);
    res.json({ ok: true, platform: result.platform, length: result.length });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    if (statusCode !== 400) {
      console.error('Failed to save cookies:', error);
    }
    res.status(statusCode).json({ error: statusCode === 400 ? error.message : 'failed to save cookies' });
  }
});

app.get('/live/:platform/:id', async (req, res) => {
  const { platform, id } = req.params;
  await streamLive({
    platform,
    id,
    res,
    req,
    streamlinkCmd: STREAMLINK_CMD,
    httpProxy,
    outputDir: OUTPUT_DIR
  });
});

await ensureOutputDir();

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
