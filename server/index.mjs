import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  port: 8899,
  STREAMLINK_CMD: 'C:\\Program Files\\Streamlink\\bin\\streamlink.exe',
  httpProxy: 'http://127.0.0.1:7897'
};

const normalizeConfig = (input) => {
  const merged = { ...DEFAULT_CONFIG, ...(input || {}) };
  const port = Number(merged.port);

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_CONFIG.port,
    STREAMLINK_CMD: String(merged.STREAMLINK_CMD || DEFAULT_CONFIG.STREAMLINK_CMD),
    httpProxy: String(merged.httpProxy || DEFAULT_CONFIG.httpProxy)
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

const config = await loadConfig();

const app = express();
const PORT = config.port;
const STREAMLINK_CMD = config.STREAMLINK_CMD;
const httpProxy = config.httpProxy;

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

const platformUrlMap = {
  youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
  bilibili: (id) => `https://live.bilibili.com/${id}`
};

app.get('/live/:platform/:id', (req, res) => {
  const { platform, id } = req.params;
  const buildUrl = platformUrlMap[platform];

  if (!buildUrl) {
    res.status(400).json({ error: 'unsupported platform' });
    return;
  }

  const url = buildUrl(id);

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store');

  const streamArgs = [
    '--loglevel', 'warning',
    '--stream-segment-threads', '3',
    '--hls-live-edge', '2',
    '--stream-timeout', '60',
    '--http-no-ssl-verify',
    url,
    'best',
    '-O'
  ];

  if (httpProxy) {
    streamArgs.unshift('--http-proxy', httpProxy);
  }

  const stream = spawn(STREAMLINK_CMD, streamArgs, {
    windowsHide: true
  });

  const cleanup = () => {
    if (!stream.killed) {
      stream.kill();
    }
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);
  req.on('aborted', cleanup);

  stream.stdout.pipe(res);

  stream.stderr.on('data', (data) => {
    console.error(`[streamlink stderr]: ${data}`);
  });

  stream.on('close', (code, signal) => {
    if (!res.headersSent) {
      res.status(500).end('streamlink closed');
    } else {
      res.end();
    }
    console.log(`streamlink exited with code ${code} and signal ${signal}`);
  });

  stream.on('error', (err) => {
    console.error('Failed to start streamlink:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'failed to start streamlink' });
    } else {
      res.end();
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
