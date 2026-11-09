// 시연용 저장 결과 만들기: 테스트 페이지마다 실제 AI로 상세 이미지 읽기와 요약을 실행해 extension/lib/demo-data.js에 저장한다.
// 사용법: eval 폴더에서 GEMINI_API_KEY=... npm run demo:capture  (NVIDIA_API_KEY와 NVIDIA_MODEL도 가능)
// 실패한 페이지는 예전 저장 결과를 그대로 두고 끝에 알린다. --mock은 도구 점검용 가짜 AI, --out은 저장 위치.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { serveShop } from './shop/serve.mjs';
import { chooseProviders, closeOptionsTab, gitVersion, modelOf, providerSettings, scrollThrough } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(here, '../extension');
const { values: args } = parseArgs({
  options: { mock: { type: 'boolean', default: false }, providers: { type: 'string' }, out: { type: 'string', default: path.join(EXTENSION, 'lib/demo-data.js') } }
});

const productIds = [...fs.readFileSync(path.join(here, 'mall/data.js'), 'utf8').matchAll(/^\s+id: '(\w+)',$/gm)].map((m) => m[1]);
const PAGES = ['/shop/', '/mall/', ...productIds.map((id) => `/mall/product.html?id=${id}`)];

function mockAnswer(prompt) {
  if (Array.isArray(prompt)) return '시연용 글자';
  if (prompt.startsWith('쇼핑몰 상품 상세')) return JSON.stringify({ sections: [{ title: '가격·할인', items: ['가짜 AI 저장 결과'] }] });
  return JSON.stringify({ overview: '가짜 AI 요약입니다.', items: [{ text: '가짜 요약 항목', sources: [1] }] });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/mock/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ choices: [{ message: { content: mockAnswer(JSON.parse(body).messages[0].content) } }] }));
  }
  if (serveShop(req, res)) return;
  res.statusCode = 404;
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const [providerName] = chooseProviders({ mock: args.mock, providers: args.providers });
const settings = providerSettings(providerName, `${base}/mock/v1`);
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-capture-')), {
  channel: 'chromium',
  headless: true,
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
});

// 탭 안에서 사용자가 단축키를 눌렀을 때와 같은 메시지를 서비스 워커에 보낸다
function runInTab(sw, url) {
  return sw.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-text.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const urls = [...document.querySelectorAll('.detail-images img')].map((img) => new URL(img.dataset.src || img.src, location.href).href);
        const { payload } = window.__ssucreamPage.collect();
        const summary = await chrome.runtime.sendMessage({ type: 'summarize-page', page: payload });
        const detail = urls.length ? await chrome.runtime.sendMessage({ type: 'extract-detail', urls }) : null;
        return { urls, paragraphs: payload.paragraphs, summary, detail };
      }
    });
    return result;
  }, url);
}

function toRecord({ urls, paragraphs, summary, detail }, meta) {
  if (!summary || summary.error) throw new Error(`요약 실패: ${summary?.error ?? '응답 없음'}`);
  if (detail?.error) throw new Error(`상세 이미지 실패: ${detail.error}`);
  if (urls.length && (!detail || detail.truncated || detail.failedCount || detail.imageCount !== urls.length)) {
    throw new Error(`상세 이미지를 전부 읽지 못함: ${detail?.imageCount ?? 0}/${urls.length}개`);
  }
  return {
    ...meta,
    detail: detail ? { images: urls.map((url) => new URL(url).pathname), sections: detail.sections } : null,
    summary: {
      overview: summary.overview,
      items: summary.items.map((item) => ({ text: item.text, sourceTexts: item.sources.map((n) => paragraphs[n - 1]) }))
    }
  };
}

const existing = fs.existsSync(args.out) ? (await import(pathToFileURL(args.out).href)).DEMO_DATA.pages : {};
const pages = { ...existing };
const failed = [];
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await closeOptionsTab(context);
  await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), { aiEnabled: true, ...settings });
  const meta = { capturedAt: new Date().toISOString(), provider: providerName, model: modelOf(settings), commit: gitVersion().commit };
  for (const pagePath of PAGES) {
    const page = await context.newPage();
    try {
      await page.goto(base + pagePath, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await scrollThrough(page);
      const started = Date.now();
      pages[pagePath] = toRecord(await runInTab(sw, page.url()), meta);
      console.log(`저장: ${pagePath} (${Math.round((Date.now() - started) / 1000)}초)`);
    } catch (error) {
      failed.push(pagePath);
      console.error(`실패: ${pagePath}: ${error.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await context.close();
  server.close();
}

fs.writeFileSync(
  args.out,
  `// 시연용 저장 결과. eval/demo-capture.mjs가 실제 AI 결과로 채운다. 손으로 고치지 않는다.\nexport const DEMO_DATA = ${JSON.stringify({ pages }, null, 2)};\n`
);
console.log(`\n${PAGES.length - failed.length}/${PAGES.length}개 페이지 저장: ${args.out}`);
if (failed.length) {
  console.error(`실패한 페이지(예전 결과 유지): ${failed.join(', ')}`);
  process.exitCode = 1;
}
