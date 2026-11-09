import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
// The visual demo lives in src/demo-api.mjs once the roundtable has built it; without it the server serves only the placeholder page.
const demo = await import('./src/demo-api.mjs').catch(() => null);

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, writesEnabled: false, configured: false }));
    return;
  }
  if (demo && (await demo.handleDemo(req, res))) return;
  try {
    const page = await readFile(join(root, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  } catch {
    res.writeHead(500);
    res.end('missing public/index.html');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Plan Calendar on http://127.0.0.1:${port}`);
});
