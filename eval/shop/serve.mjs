// 쇼핑몰형 테스트 페이지(eval/shop)를 /shop/ 주소로 내려준다.
// 평가 도구(run.mjs)가 가져다 쓰고, 직접 실행하면 브라우저와 스크린리더로 둘러볼 주소를 띄운다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};

// 요청 경로를 eval/shop 안의 파일로 바꾼다. 폴더 밖이거나 내려줄 종류가 아니면 null.
export function shopFile(pathname) {
  if (!pathname.startsWith('/shop/')) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice('/shop/'.length)) || 'index.html';
  } catch {
    return null;
  }
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !TYPES[path.extname(file)]) return null;
  return file;
}

// 처리했으면 true, 해당 파일이 없으면 false (호출한 쪽이 404 등을 처리)
export function serveShop(req, res) {
  const file = shopFile(new URL(req.url, 'http://localhost').pathname);
  if (!file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return false;
  res.setHeader('content-type', TYPES[path.extname(file)]);
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  // 기본은 이 PC에서만 접속. 같은 네트워크의 다른 PC에서 열려면 HOST=0.0.0.0
  const host = process.env.HOST || '127.0.0.1';
  http
    .createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(302, { location: '/shop/' });
        return res.end();
      }
      if (!serveShop(req, res)) {
        res.statusCode = 404;
        res.end();
      }
    })
    .listen(port, host, () => console.log(`평가용 쇼핑몰: http://${host}:${port}/shop/`));
}
