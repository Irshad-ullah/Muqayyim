import http from 'http';

// A fake downstream service. Each request is recorded; the response status can
// be chosen per request with the `x-stub-status` header, and any path ending in
// `/hang` never responds (for timeout tests). It also sends X-Powered-By so we
// can check the gateway strips it.
export const startStub = async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
    });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, size });
      if (req.url.endsWith('/hang')) return; // never answer
      const status = Number(req.headers['x-stub-status'] || 200);
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-Powered-By': 'Express' });
      res.end(JSON.stringify({ upstream: true, status }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${server.address().port}`;
  const close = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    });
  return { url, hits, close };
};

// Point both gateway targets at `url` (must run before importing app.js).
export const useTargets = (url) => {
  process.env.AUTH_SERVICE_URL = url;
  process.env.CV_SERVICE_URL = url;
};
