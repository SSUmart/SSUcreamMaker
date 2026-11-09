// 시연용 저장 결과 E2E 점검: 임시로 복사한 확장에 가짜 AI 저장 결과를 넣고, 테스트 서버 주소를 이 컴퓨터로 돌려
// AI 설정 없이 상세 이미지와 요약이 바로 나오는지, 로컬 주소에서는 원래 길로 가는지 확인한다.
// 사용법: eval 폴더에서 npm run e2e:demo
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from './shop/serve.mjs';
import { closeOptionsTab, scrollThrough } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-ext-'));
fs.cpSync(path.resolve(here, '../extension'), EXT, { recursive: true });
execFileSync(process.execPath, [path.join(here, 'demo-capture.mjs'), '--mock', '--out', path.join(EXT, 'lib/demo-data.js')], { stdio: 'inherit' });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};

const saved = fs.readFileSync(path.join(EXT, 'lib/demo-data.js'), 'utf8');
for (const key of ['/shop/', '/mall/', '/mall/product.html?id=mug', '/mall/product.html?id=earphone']) check(`저장: ${key}`, saved.includes(`"${key}"`));

let aiCalls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    aiCalls++;
    res.statusCode = 500;
    return res.end();
  }
  if (serveShop(req, res)) return;
  res.statusCode = 404;
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-demo-')), {
  channel: 'chromium',
  headless: true,
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP ssu.jaymong.me 127.0.0.1']
});

const inTab = (sw, url, what) =>
  sw.evaluate(
    async ({ url, what }) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
      const files = what === 'detail' ? ['content/page-text.js', 'content/detail.js'] : ['content/page-text.js'];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [what],
        func: async (what) => {
          if (what === 'summary') return chrome.runtime.sendMessage({ type: 'summarize-page', page: window.__ssucreamPage.collect().payload });
          const started = performance.now();
          for (;;) {
            const state = document.getElementById('ssucream-status')?.dataset.state;
            if (state === 'done' || state === 'error') {
              return { state, text: document.getElementById('ssucream-detail')?.innerText ?? '', status: document.getElementById('ssucream-status')?.textContent ?? '', ms: performance.now() - started };
            }
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      });
      return result;
    },
    { url, what }
  );

try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await closeOptionsTab(context);

  const open = async (url) => {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await scrollThrough(page);
    return page;
  };

  const demoUrl = `http://ssu.jaymong.me:${port}/mall/product.html?id=mug`;
  const demo = await open(demoUrl);
  const detail = await inTab(sw, demo.url(), 'detail');
  check('테스트 서버: 상세 이미지 저장 결과가 나옴', detail.state === 'done' && detail.text.includes('가짜 AI 저장 결과'), JSON.stringify(detail));
  check('테스트 서버: 제목은 AI 추출 그대로', detail.text.includes('상세 이미지 내용, AI 추출'), detail.text);
  check('테스트 서버: 1초 안에 끝남', detail.ms < 1000, String(detail.ms));
  const summary = await inTab(sw, demo.url(), 'summary');
  check('테스트 서버: 요약 저장 결과가 나옴', summary.overview === '가짜 AI 요약입니다.' && summary.items[0]?.text === '가짜 요약 항목', JSON.stringify(summary));
  check('테스트 서버: 요약 근거 문단 번호가 살아 있음', summary.items[0]?.sources.length === 1, JSON.stringify(summary));
  check('테스트 서버: AI를 부르지 않음', aiCalls === 0, String(aiCalls));

  const cart = await open(`http://ssu.jaymong.me:${port}/mall/cart.html`);
  const cartSummary = await inTab(sw, cart.url(), 'summary');
  check('테스트 서버 장바구니: 저장 결과 없이 원래 길', Boolean(cartSummary.error), JSON.stringify(cartSummary));

  const local = await open(`http://127.0.0.1:${port}/mall/product.html?id=mug`);
  const localDetail = await inTab(sw, local.url(), 'detail');
  check('로컬 주소: 저장 결과를 쓰지 않음', localDetail.state === 'error' && !localDetail.text.includes('가짜 AI 저장 결과'), JSON.stringify(localDetail));
  const localSummary = await inTab(sw, local.url(), 'summary');
  check('로컬 주소: 요약도 원래 길', Boolean(localSummary.error), JSON.stringify(localSummary));
} finally {
  await context.close();
  server.close();
}
console.log(failures ? `\n실패 ${failures}개` : '\n모두 통과');
process.exitCode = failures ? 1 : 0;
