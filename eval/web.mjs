// 테스트 서버에서 한 포트(기본 8080)로 평가용 웹 페이지를 모두 띄운다. systemd 서비스로 띄울 때 쓴다 (docs/EVAL-WEB-SERVICE.md).
//   /mall/   가상 쇼핑몰 온글몰 (주문·결제까지)
//   /shop/   평가용 쇼핑몰 상품 페이지
//   /guide/  온글 설치 가이드 (ChatGPT 계정 연결까지, 사용자에게 주는 페이지)
//   /survey/ 평가 설문 (관리자 /survey/admin, 응답 링크 /survey/s/<토큰>). SURVEY_ADMIN_PASSWORD가 있을 때만 켠다
//
// 실행 (eval 폴더에서): SURVEY_ADMIN_PASSWORD=<비밀번호> npm run web
//   PORT(기본 8080), HOST(기본 127.0.0.1, 다른 PC·nginx에서 열려면 0.0.0.0), START(/ 로 들어오면 갈 곳, 기본 /mall/),
//   SURVEY_DATA_DIR(응답 저장 폴더, 기본 eval/survey/data), SURVEY_PATH(기본 /survey)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from './shop/serve.mjs';
import { createSurveyHandler } from './survey/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function createWebServer({ start = '/mall/', survey } = {}) {
  const surveyHandler = survey ? createSurveyHandler(survey) : null;
  const surveyBase = survey ? (survey.basePath || '').replace(/\/+$/, '') : '';
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/') {
      res.writeHead(302, { location: start });
      return res.end();
    }
    // 끝의 / 없이 들어오면 붙여 준다 (가이드의 그림 주소가 상대 경로라서)
    if (pathname === '/guide') {
      res.writeHead(301, { location: '/guide/' });
      return res.end();
    }
    if (surveyHandler?.(req, res)) return;
    if (!surveyHandler && /^\/survey(\/|$)/.test(pathname)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('설문 서비스가 꺼져 있습니다. 서버에 SURVEY_ADMIN_PASSWORD를 설정하세요.');
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(`ok${surveyBase ? ' (survey on)' : ''}`);
    }
    if (!serveShop(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  const password = process.env.SURVEY_ADMIN_PASSWORD;
  const basePath = process.env.SURVEY_PATH || '/survey';
  const dataDir = path.resolve(process.env.SURVEY_DATA_DIR || path.join(HERE, 'survey', 'data'));
  const server = createWebServer({ start: process.env.START || '/mall/', survey: password ? { dataDir, password, basePath } : null });
  server.listen(port, host, () => {
    console.log(`가상 쇼핑몰(온글몰): http://${host}:${port}/mall/`);
    console.log(`평가용 쇼핑몰(상품 페이지): http://${host}:${port}/shop/`);
    console.log(`설치 가이드: http://${host}:${port}/guide/`);
    if (password) console.log(`평가 설문 관리자: http://${host}:${port}${basePath}/admin (응답 저장: ${dataDir})`);
    else console.log('평가 설문: 꺼짐 (SURVEY_ADMIN_PASSWORD가 없음)');
  });
  // systemd가 멈출 때(SIGTERM) 받던 요청을 마무리하고 끝낸다
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}
