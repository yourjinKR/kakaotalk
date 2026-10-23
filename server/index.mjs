import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ApiError, MessengerStore } from './store.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
};

async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON 요청이 필요합니다.');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > 32_768) throw new ApiError(413, '요청 본문이 너무 큽니다.');
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_768) throw new ApiError(413, '요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, '올바른 JSON을 입력해 주세요.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(400, 'JSON 객체가 필요합니다.');
  return parsed;
}

function checkLocalRequest(request) {
  const host = request.headers.host;
  if (!host || !/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) throw new ApiError(403, '로컬 주소로만 접속할 수 있습니다.');
  if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new ApiError(403, '다른 출처의 요청을 허용하지 않습니다.');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, '다른 사이트의 요청을 허용하지 않습니다.');
}

export async function createServer({ dataFile = process.env.KATOK_DATA_FILE || join(projectRoot, 'data', 'messenger.json'), publicDir = join(projectRoot, 'public') } = {}) {
  const clients = new Set();
  const notify = userIds => {
    for (const client of clients) {
      if (userIds.includes(client.userId)) client.response.write('event: change\ndata: {}\n\n');
    }
  };
  const store = await MessengerStore.open(resolve(dataFile), notify);
  const server = createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      checkLocalRequest(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const path = url.pathname;
      const method = request.method;
      if (path.startsWith('/api/')) {
        const userId = url.searchParams.get('user') || 'me';
        store.user(userId);
        if (method === 'GET' && path === '/api/bootstrap') return json(response, 200, store.bootstrap(userId));
        if (method === 'GET' && path === '/api/events') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
          });
          response.write('retry: 2000\nevent: ready\ndata: {}\n\n');
          const client = { userId, response };
          clients.add(client);
          const timer = setInterval(() => response.write(': keepalive\n\n'), 15_000);
          timer.unref();
          response.on('close', () => { clearInterval(timer); clients.delete(client); });
          return;
        }
        if (method === 'POST' && path === '/api/friends') {
          const input = await body(request);
          return json(response, 201, await store.addFriend(userId, input.userId));
        }
        const friendMatch = /^\/api\/friends\/([^/]+)$/.exec(path);
        if (method === 'PATCH' && friendMatch) {
          const input = await body(request);
          return json(response, 200, await store.setFriendHidden(userId, decodeURIComponent(friendMatch[1]), input.hidden));
        }
        if (method === 'POST' && path === '/api/rooms') {
          const input = await body(request);
          return json(response, 201, await store.createRoom(userId, input.memberIds, input.title));
        }
        const messageMatch = /^\/api\/rooms\/([^/]+)\/messages$/.exec(path);
        if (messageMatch && method === 'GET') return json(response, 200, store.messages(decodeURIComponent(messageMatch[1]), userId));
        if (messageMatch && method === 'POST') {
          const input = await body(request);
          return json(response, 201, await store.sendMessage(userId, decodeURIComponent(messageMatch[1]), input.text, input.clientId));
        }
        const readMatch = /^\/api\/rooms\/([^/]+)\/read$/.exec(path);
        if (readMatch && method === 'POST') {
          const input = await body(request);
          return json(response, 200, await store.markRead(userId, decodeURIComponent(readMatch[1]), input.sequence));
        }
        throw new ApiError(404, 'API 경로를 찾을 수 없습니다.');
      }
      if (!['GET', 'HEAD'].includes(method)) throw new ApiError(405, '허용하지 않는 요청입니다.');
      const file = staticFiles.get(path);
      if (!file) throw new ApiError(404, '파일을 찾을 수 없습니다.');
      let content;
      try { content = await readFile(join(publicDir, file[0])); }
      catch (error) { if (error.code === 'ENOENT') throw new ApiError(404, '파일을 찾을 수 없습니다.'); throw error; }
      response.writeHead(200, { 'Content-Type': file[1], 'Content-Length': content.length });
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.end(); return; }
      const status = error instanceof ApiError ? error.status : error instanceof URIError ? 400 : 500;
      if (status === 500) console.error('요청 처리 실패:', error);
      json(response, status, { error: status === 500 ? '요청을 저장하거나 처리하지 못했습니다.' : error.message });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const close = async () => {
    for (const client of clients) client.response.end();
    if (!server.listening) return;
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  };
  return { server, store, close };
}

export async function startServer({ port = Number(process.env.PORT || 4173), ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT는 0~65535 사이 정수여야 합니다.');
  const application = await createServer(options);
  await new Promise((resolveListen, reject) => {
    application.server.once('error', reject);
    application.server.listen(port, '127.0.0.1', () => {
      application.server.removeListener('error', reject);
      resolveListen();
    });
  });
  return { ...application, url: `http://127.0.0.1:${application.server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const app = await startServer();
    console.log(`카톡 로컬 데모: ${app.url}`);
    console.log('합성 계정 전용 프로토타입입니다. 계정 전환은 인증 기능이 아닙니다.');
    const shutdown = async () => { await app.close(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error(`서버 시작 실패: ${error.message}`);
    process.exitCode = 1;
  }
}
