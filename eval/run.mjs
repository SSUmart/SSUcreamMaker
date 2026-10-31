// 상세 이미지 글자 추출 평가: 실제 Chromium에 확장을 올려 사례별로 실행하고 정답과 비교한다.
// 사용법은 eval/README.md 참고.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { scoreCase, summarize, summarizeCases, toMarkdown } from './score.js';
import { serveShop } from './shop/serve.mjs';
import { NIM_RECOMMENDED_MODELS } from '../extension/lib/settings.js';

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

// 공급자 설정은 환경 변수에서 읽는다. 키를 파일에 쓰지 않기 위함.
function providerSettings(name, mockBaseUrl) {
  if (name === 'gemini') {
    return {
      provider: 'gemini',
      gemini: { apiKey: process.env.GEMINI_API_KEY ?? '', model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' }
    };
  }
  if (name === 'nim') {
    if (!process.env.NVIDIA_MODEL) {
      throw new Error(`NVIDIA_MODEL 환경 변수로 NIM 모델을 정해주세요. 추천 후보: ${NIM_RECOMMENDED_MODELS.join(', ')}`);
    }
    return {
      provider: 'nim',
      nim: {
        apiKey: process.env.NVIDIA_API_KEY ?? '',
        model: process.env.NVIDIA_MODEL,
        baseUrl: process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1'
      }
    };
  }
  if (name === 'mock') {
    // 평가 도구 자체 점검용. 가짜 AI 서버가 정해진 답을 돌려준다.
    return { provider: 'nim', nim: { apiKey: 'mock', model: 'mock', baseUrl: mockBaseUrl } };
  }
  throw new Error(`알 수 없는 공급자: ${name}`);
}

function chooseProviders() {
  if (args.mock) return ['mock'];
  if (args.providers) return args.providers.split(',').map((p) => p.trim());
  const found = [];
  if (process.env.GEMINI_API_KEY) found.push('gemini');
  if (process.env.NVIDIA_API_KEY) found.push('nim');
  if (!found.length) {
    throw new Error('GEMINI_API_KEY 또는 NVIDIA_API_KEY 환경 변수가 필요합니다. 도구 점검만 하려면 --mock');
  }
  return found;
}

// 결과만 보고도 어떤 조건에서 돌렸는지 알 수 있게 코드 버전을 남긴다.
// 커밋하지 않은 변경이 있으면 dirty로 표시한다(그 결과는 커밋만으로 다시 만들 수 없다).
function gitVersion() {
  const git = (...cmd) => execFileSync('git', cmd, { cwd: here, encoding: 'utf8' }).trim();
  try {
    return { commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' };
  } catch {
    return { commit: null, dirty: null };
  }
}

// 공급자 설정에서 모델 이름만 뽑는다. API 키는 결과 파일에 남기지 않는다.
function modelOf(settings) {
  return settings[settings.provider]?.model ?? null;
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

// 확장은 설치 직후 설정 탭을 연다. 이 탭이 평가용 탭을 가로채지 않도록 열릴 때까지 기다렸다 닫는다.
async function closeOptionsTab(context) {
  for (let i = 0; i < 50; i++) {
    const tab = context.pages().find((p) => p.url().includes('/options/options.html'));
    if (tab) return tab.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// 지연 로딩되는 상세 이미지를 불러오도록 끝까지 천천히 내린다.
async function scrollThrough(page) {
  for (let i = 0; i < 40; i++) {
    const atBottom = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    });
    await page.waitForTimeout(250);
    if (atBottom) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
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
  const providers = chooseProviders();
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
      // 영구 컨텍스트는 browser()가 null이라 확장의 서비스 워커에서 읽는다. userAgent는 뒷자리를 0으로 감춘다
      chromium: await sw.evaluate(async () => {
        const { fullVersionList = [] } = (await navigator.userAgentData?.getHighEntropyValues(['fullVersionList'])) ?? {};
        return fullVersionList.find((b) => b.brand === 'Chromium')?.version ?? null;
      }),
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
