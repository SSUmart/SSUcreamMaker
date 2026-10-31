// 상세 이미지 글자 추출 평가: 실제 Chromium에 확장을 올려 사례별로 실행하고 정답과 비교한다.
// 사용법은 eval/README.md 참고.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scoreCase, summarize, summarizeCases, toMarkdown } from './score.js';
import { serveShop } from './shop/serve.mjs';
import {
  chooseProviders,
  chromiumVersion,
  closeOptionsTab,
  gitVersion,
  modelOf,
  providerSettings,
  scrollThrough
} from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(here, '../extension');
const CASE_TIMEOUT_MS = 180_000;

const { values: args } = parseArgs({
  options: {
    providers: { type: 'string' },
    cases: { type: 'string', default: path.join(here, 'cases.json') },
    only: { type: 'string' },
    headed: { type: 'boolean', default: false },
    mock: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' }
  }
});

const REPEAT = Number(args.repeat);
if (!Number.isInteger(REPEAT) || REPEAT < 1) {
  console.error('--repeat 는 1 이상의 정수여야 합니다');
  process.exit(1);
}

const MOCK_SECTIONS = JSON.stringify({
  sections: [
    { title: '가격·할인', items: ['정가 39,000원', '할인가 29,000원'] },
    { title: '주의사항', items: ['세탁기 사용 불가'] }
  ]
});

// 사례 이미지(fixture) 페이지, 쇼핑몰형 테스트 페이지(/shop/), 가짜 AI 서버
function startServer(fixtureImages) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/mock/v1/chat/completions') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const isImage = Array.isArray(JSON.parse(body).messages[0].content);
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({ choices: [{ message: { content: isImage ? '정가 39,000원' : MOCK_SECTIONS } }] })
      );
    }
    const match = req.url.match(/^\/fixture\/([\w-]+)\.(html|png)$/);
    if (match && fixtureImages.has(match[1])) {
      const [, id, ext] = match;
      if (ext === 'png') {
        res.setHeader('content-type', 'image/png');
        return res.end(fixtureImages.get(id));
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(
        `<!doctype html><html lang="ko"><body><h1>평가용 상품</h1>` +
          `<div id="detail"><img src="/fixture/${id}.png" alt=""></div></body></html>`
      );
    }
    if (serveShop(req, res)) return;
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function renderFixture(context, { width, lines }) {
  const page = await context.newPage();
  const base64 = await page.evaluate(
    ([width, lines]) => {
      const lineHeight = 150;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 120 + lines.length * lineHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // 줄은 글자만 쓰거나, 실제 상세 이미지에서 AI가 자주 틀리는 모양(취소선, 작은·흐린 글씨, 색 배경)을 객체로 준다
      lines.forEach((line, i) => {
        const { text, size = 40, color = '#222', bg, strike } = typeof line === 'string' ? { text: line } : line;
        const y = 120 + i * lineHeight;
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, y - lineHeight / 2 - size / 2, canvas.width, lineHeight);
        }
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px sans-serif`;
        ctx.fillText(text, 60, y);
        if (strike) ctx.fillRect(60, y - size / 3, ctx.measureText(text).width, Math.max(2, size / 12));
      });
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [width, lines]
  );
  await page.close();
  return Buffer.from(base64, 'base64');
}

async function runCase(context, sw, url, testCase) {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    if (response && response.status() >= 400) {
      return { ok: false, error: `페이지 응답 ${response.status()} (봇 차단 가능성)` };
    }
    await scrollThrough(page);

    const started = Date.now();
    await sw.evaluate(async (pageUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url === pageUrl);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-text.js', 'content/detail.js'] });
    }, page.url());
    await page.waitForFunction(
      () => ['done', 'error'].includes(document.getElementById('ssucream-status')?.dataset.state),
      null,
      { timeout: CASE_TIMEOUT_MS }
    );
    const ms = Date.now() - started;
    await page.waitForFunction(() => document.getElementById('ssucream-status').textContent.trim());

    const outcome = await page.evaluate(() => {
      const status = document.getElementById('ssucream-status');
      const section = document.getElementById('ssucream-detail');
      if (status.dataset.state === 'error') return { error: status.textContent.trim() };
      const sections = [...section.querySelectorAll('h3')].map((h) => ({
        title: h.textContent,
        items: [...h.nextElementSibling.querySelectorAll('li')].map((li) => li.textContent)
      }));
      // 안내 문장 중 실패·생략 알림만 남긴다.
      const notice = section.querySelector('p').textContent.match(/이미지가 많아[^.]*\.|이미지 \d+개는 가져오지 못했습니다\./g);
      return { sections, notice: notice?.join(' ') };
    });
    if (outcome.error) return { ok: false, ms, error: outcome.error };
    return {
      ok: true,
      ms,
      sections: outcome.sections,
      notice: outcome.notice,
      score: scoreCase(outcome.sections, testCase.expect ?? {})
    };
  } catch (error) {
    return { ok: false, error: error.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

async function main() {
  const providers = chooseProviders(args);
  let cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
  if (args.only) cases = cases.filter((c) => args.only.split(',').includes(c.id));

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssucream-eval-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: !args.headed,
    locale: 'ko-KR',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
  });
  const fixtureImages = new Map();
  const server = await startServer(fixtureImages);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOptionsTab(context);
    for (const c of cases.filter((c) => c.fixture)) {
      fixtureImages.set(c.id, await renderFixture(context, c.fixture));
    }

    const startedAt = new Date();
    const models = {};
    const results = [];
    for (const provider of providers) {
      const settings = { aiEnabled: true, ...providerSettings(provider, `${base}/mock/v1`) };
      models[provider] = modelOf(settings);
      await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
      // 회차를 바깥에 두어 한 사례를 몰아서 돌리지 않는다. 그 순간의 API 상태가 한 사례에만 몰리지 않게 하기 위함.
      for (let run = 1; run <= REPEAT; run++) {
        for (const c of cases) {
          // 캐시를 비워 매번 실제로 AI를 호출한 시간을 잰다.
          await sw.evaluate(() => chrome.storage.session.clear());
          const url = c.fixture ? `${base}/fixture/${c.id}.html` : c.page ? base + c.page : c.url;
          console.error(`[${provider}] ${c.id} 실행 중${REPEAT > 1 ? ` (${run}/${REPEAT})` : ''}`);
          results.push({ provider, caseId: c.id, run, ...(await runCase(context, sw, url, c)) });
        }
      }
    }

    const meta = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ...gitVersion(),
      models,
      repeat: REPEAT,
      cases: path.relative(here, args.cases),
      headed: args.headed,
      chromium: await chromiumVersion(sw),
      node: process.version
    };
    const summary = summarize(results);
    const byCase = summarizeCases(results);
    const resultsDir = path.join(here, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const file = path.join(resultsDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ meta, providers, summary, byCase, results }, null, 2));
    const modelText = Object.entries(models).map(([p, m]) => `${p} ${m}`).join(', ');
    console.error(`\n코드 ${meta.commit ?? '알 수 없음'}${meta.dirty ? ' (커밋하지 않은 변경 있음)' : ''}, 모델 ${modelText}, ${REPEAT}회`);
    console.log(toMarkdown(summary, results));
    console.error(`\n결과 저장: ${path.relative(process.cwd(), file)}`);
  } finally {
    await context.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
