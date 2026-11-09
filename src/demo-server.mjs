// Serves the visual demo on its own: node src/demo-server.mjs, then open http://127.0.0.1:3000/demo
// The same handler (handleDemo in demo-api.mjs) can be called from server.mjs before its own routes.
import { createServer } from 'node:http';
import { handleDemo } from './demo-api.mjs';

export function startDemoServer(port = Number(process.env.PORT || 3000)) {
  const server = createServer(async (req, res) => {
    if (await handleDemo(req, res)) return;
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, writesEnabled: false, configured: false })); return; }
    res.writeHead(302, { location: '/demo' }); res.end();
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const s = await startDemoServer();
  console.log(`Plan Calendar demo on http://127.0.0.1:${s.address().port}/demo`);
}
