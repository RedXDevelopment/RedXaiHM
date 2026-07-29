import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { RedXaiFileStore } from './store.js';
import { parse } from './parser.js';
import { serialize } from './serializer.js';
import { validate } from './validator.js';

const here = dirname(fileURLToPath(import.meta.url));
const editorRoot = resolve(here, '../editor');
const assetRoot = resolve(here, '../assets');

export async function launchEditor(filePath, options = {}) {
  const absolutePath = resolve(filePath);
  const token = randomBytes(24).toString('hex');
  const store = new RedXaiFileStore();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (url.searchParams.get('token') !== token) return sendJson(response, 403, { error: 'Forbidden' });
        if (url.pathname === '/api/document' && request.method === 'GET') {
          const loaded = await store.load(absolutePath);
          return sendJson(response, 200, {
            fileName: basename(absolutePath),
            source: serialize(loaded.document),
            warnings: loaded.warnings,
            recoveredFrom: loaded.recoveredFrom ?? null,
          });
        }
        if (url.pathname === '/api/validate' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const document = parse(String(body.source ?? ''));
          return sendJson(response, 200, { issues: validate(document), formatted: serialize(document) });
        }
        if (url.pathname === '/api/save' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const document = parse(String(body.source ?? ''));
          const issues = validate(document);
          const errors = issues.filter((item) => item.severity === 'error');
          if (errors.length) return sendJson(response, 422, { error: 'Validation failed', issues });
          await store.save(absolutePath, document);
          return sendJson(response, 200, { saved: true, source: serialize(document), issues });
        }
        return sendJson(response, 404, { error: 'Not found' });
      }

      if (url.pathname === '/') return sendFile(response, join(editorRoot, 'index.html'), 'text/html; charset=utf-8');
      if (url.pathname === '/app.js') return sendFile(response, join(editorRoot, 'app.js'), 'text/javascript; charset=utf-8');
      if (url.pathname === '/styles.css') return sendFile(response, join(editorRoot, 'styles.css'), 'text/css; charset=utf-8');
      if (url.pathname === '/icon.svg') return sendFile(response, join(assetRoot, 'redxai-file-icon.svg'), 'image/svg+xml');
      response.writeHead(404).end('Not found');
    } catch (error) {
      sendJson(response, 500, {
        error: error.message,
        issues: error.issues ?? null,
      });
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/?token=${token}`;
  if (options.open !== false) openBrowser(url);
  return { server, url, filePath: absolutePath };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('Editor request exceeds 5 MB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function sendFile(response, path, contentType) {
  const content = await readFile(path);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(content);
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
