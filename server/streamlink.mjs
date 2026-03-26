import { spawn } from 'child_process';

const platformUrlMap = {
  youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
  bilibili: (id) => `https://live.bilibili.com/${id}`
};

const streamLive = ({ platform, id, res, req, streamlinkCmd, httpProxy }) => {
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

  const stream = spawn(streamlinkCmd, streamArgs, {
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

  let hasOutput = false;
  let errorText = '';

  stream.stdout.on('data', () => {
    hasOutput = true;
  });

  stream.stdout.pipe(res);

  stream.stderr.on('data', (data) => {
    const text = data.toString();
    errorText += text;
    console.error(`[streamlink stderr]: ${text}`);

    if (!hasOutput && /No playable streams|live event has ended|not live|offline/i.test(text)) {
      if (!res.headersSent) {
        res.status(410).json({ error: 'stream not live' });
      }
      cleanup();
    }
  });

  stream.on('close', (code, signal) => {
    if (!res.headersSent) {
      if (!hasOutput && /No playable streams|live event has ended|not live|offline/i.test(errorText)) {
        res.status(410).json({ error: 'stream not live' });
      } else {
        res.status(500).end('streamlink closed');
      }
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
};

export { streamLive };
