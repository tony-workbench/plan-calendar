// Standalone server for the demo page: node src/demo-server.mjs (PORT, default 3001). server.mjs mounts the same handler at /demo.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleDemo } from './demo-api.mjs';

export function startDemoServer(port = Number(process.env.PORT || 3001)) {
  const server = createServer(async (req, res) => {
    if (await handleDemo(req, res)) return;
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startDemoServer();
  console.log(`Demo on http://127.0.0.1:${server.address().port}/demo`);
}
