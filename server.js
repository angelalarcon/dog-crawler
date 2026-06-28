import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { crawl } from './crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── SSE crawl endpoint ─────────────────────────────────────────────────────
  if (url.pathname === '/crawl') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url param' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Keep-alive ping every 15s so the connection doesn't time out
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);

    try {
      const dogs = await crawl(targetUrl, {
        concurrency: 4,
        onProgress({ phase, current, total, name }) {
          send('progress', { phase, current, total, name });
        },
        onDog(dog) {
          send('dog', dog);
        },
      });

      send('done', { total: dogs.length });
    } catch (err) {
      send('error', { message: err.message });
    } finally {
      clearInterval(ping);
      res.end();
    }
    return;
  }

  // ── Static files ───────────────────────────────────────────────────────────
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, filePath);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🐾 Dog Crawler UI corriendo en http://localhost:${PORT}\n`);
});
