import fs from 'fs/promises';
import path from 'path';

const DEFAULT_SUBSCRIPTION_NAME = 'live.m3u';

const ensureOutputDir = async (outputDir) => {
  await fs.mkdir(outputDir, { recursive: true });
};

const readSubscription = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '#EXTM3U';
    }
    throw error;
  }
};

const writeSubscription = async (filePath, content) => {
  const trimmed = String(content || '').trim();
  const payload = trimmed ? trimmed : '#EXTM3U';
  await fs.writeFile(filePath, `${payload}\n`, 'utf-8');
  return payload;
};

const createSubscriptionService = (options = {}) => {
  const outputDir = options.outputDir || process.cwd();
  const filename = options.filename || DEFAULT_SUBSCRIPTION_NAME;
  const filePath = path.join(outputDir, filename);

  return {
    filePath,
    ensureOutputDir: () => ensureOutputDir(outputDir),
    read: () => readSubscription(filePath),
    write: (content) => writeSubscription(filePath, content)
  };
};

const registerSubscriptionRoutes = (app, options = {}) => {
  const service = createSubscriptionService(options);

  app.get('/subscription.m3u', async (_req, res) => {
    try {
      const content = await service.read();
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
      await service.ensureOutputDir();
      const content = String(req.body?.content || '');
      const payload = await service.write(content);
      res.json({ ok: true, length: payload.length });
    } catch (error) {
      console.error('Failed to save subscription:', error);
      res.status(500).json({ error: 'failed to save subscription' });
    }
  });

  return service;
};

export { createSubscriptionService, registerSubscriptionRoutes };
