const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'media');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mov': 'video/quicktime'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeMediaName(originalName) {
  const decoded = decodeURIComponent(originalName || 'media');
  const ext = path.extname(decoded).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(decoded, path.extname(decoded)).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'media';
  return `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${base}${ext}`;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/products' && req.method === 'GET') {
    if (!fs.existsSync(PRODUCTS_FILE)) return sendJson(res, 200, { products: null });
    return sendJson(res, 200, { products: JSON.parse(await fs.promises.readFile(PRODUCTS_FILE, 'utf8')) });
  }
  if (url.pathname === '/api/products' && req.method === 'PUT') {
    const payload = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8'));
    if (!Array.isArray(payload.products)) return sendJson(res, 400, { error: 'products must be an array' });
    await fs.promises.writeFile(PRODUCTS_FILE, JSON.stringify(payload.products, null, 2));
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/media' && req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      return sendJson(res, 415, { error: 'Only image and video uploads are supported' });
    }
    const fileName = safeMediaName(String(req.headers['x-file-name'] || 'media'));
    await fs.promises.writeFile(path.join(MEDIA_DIR, fileName), await readBody(req, 100 * 1024 * 1024));
    return sendJson(res, 201, { url: `/media/${encodeURIComponent(fileName)}` });
  }
  return sendJson(res, 404, { error: 'API route not found' });
}

function serveFile(req, res, url) {
  const requestPath = url.pathname === '/' ? '/zenvolt_full_website_v2.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${requestPath}`);
  if (!filePath.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendJson(res, 404, { error: 'File not found' });
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': requestPath.startsWith('/media/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveFile(req, res, url);
    else sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.message === 'Request is too large' ? 413 : 500, { error: error.message });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`ZenVolt running at http://localhost:${PORT}`);
});
