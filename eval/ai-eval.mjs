// AI 기능 평가: A1 자동 보완, A3 페이지 요약, A4 질문 응답을 실제 AI로 실행해 정답지(eval/ai/*.json)와 비교한다.
// 확장이 쓰는 길을 그대로 탄다: 탭 안에서 온글이 페이지 글·요소 정보를 모으고, 서비스 워커가 AI를 부른다.
// 사용법은 eval/README.md의 "AI 기능 평가" 참고.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
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
import { scoreLabel, scoreQuestion, scoreSummary, summarizeLabels, summarizeQa } from './ai/score.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(here, '../extension');
const TASKS = ['label', 'qa', 'summary'];
const gold = (name) => JSON.parse(fs.readFileSync(path.join(here, 'ai', `${name}.json`), 'utf8'));

const { values: args } = parseArgs({
  options: {
    providers: { type: 'string' },
    only: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    detail: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    mock: { type: 'boolean', default: false }
  }
});

const REPEAT = Number(args.repeat);
const tasks = args.only ? args.only.split(',').map((t) => t.trim()) : TASKS;
if (!Number.isInteger(REPEAT) || REPEAT < 1 || tasks.some((t) => !TASKS.includes(t))) {
  console.error(`--repeat 는 1 이상의 정수, --only 는 ${TASKS.join(',')} 중에서 고릅니다`);
  process.exit(1);
}

// 가짜 AI: 평가 도구 자체 점검용. 점수는 의미 없다.
function mockAnswer(prompt) {
  if (Array.isArray(prompt)) return '식기세척기를 사용하지 마세요.';
  if (prompt.startsWith('쇼핑몰 상품 상세')) {
    return JSON.stringify({ sections: [{ title: '주의사항', items: ['식기세척기를 사용하지 마세요.'] }] });
  }
  if (prompt.startsWith('웹페이지에 이름이 없어')) {
    const label = /share/.test(prompt) ? '공유하기' : /search/.test(prompt) ? '검색' : /delete/.test(prompt) ? '찜하기' : '이름 후보';
    return JSON.stringify({ label, confident: label !== '이름 후보' });
  }
  if (prompt.startsWith('다음 웹페이지 글을 요약하세요')) {
    return JSON.stringify({ overview: '진공 텀블러 상품 페이지입니다.', items: [{ text: '판매가 24,900원', sources: [7] }, { text: '식기세척기 사용 불가', sources: [] }] });
  }
  const question = prompt.trimEnd().split('\n').at(-1);
  return question.includes('판매가')
    ? JSON.stringify({ found: true, answer: '판매가는 24,900원입니다.', sources: [7] })
    : question.includes('보증')
      ? JSON.stringify({ found: true, answer: '보증 기간은 1년입니다.', sources: [] })
      : JSON.stringify({ found: false, answer: '', sources: [] });
}

function startServer() {
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// 평가용 탭 안(온글 content script와 같은 공간)에서 이름(name)으로 고른 함수를 실행하고 돌려준 값을 받는다.
// 확장의 보안 정책은 글로 함수를 만드는 것(eval)을 막으므로, 탭에서 돌 함수는 모두 이 안에 직접 적는다.
// 각 함수는 사용자가 단축키를 눌렀을 때와 같은 메시지를 서비스 워커에 보낸다.
function inTab(sw, page, name, arg = null) {
  return sw.evaluate(
    async ({ url, name, arg }) => {
      const fns = {
        ask: async ({ question }) => {
          const { payload } = window.__ssucreamPage.collect();
          const started = performance.now();
          const result = await chrome.runtime.sendMessage({ type: 'ask-page', page: payload, question, history: [] });
          return { result, ms: Math.round(performance.now() - started), paragraphs: payload.paragraphs };
        },
        summarize: async () => {
          const { payload } = window.__ssucreamPage.collect();
          const started = performance.now();
          const result = await chrome.runtime.sendMessage({ type: 'summarize-page', page: payload });
          return { result, ms: Math.round(performance.now() - started) };
        },
        label: async ({ selector }) => {
          const ns = globalThis.__ongeul;
          const el = document.querySelector(selector);
          if (!el) return { result: { error: `요소를 찾지 못함: ${selector}` } };
          const item = ns.model.buildItems().find((i) => i.el === el) ?? ns.model.itemFor(el);
          const started = performance.now();
          const result = await chrome.runtime.sendMessage({ type: 'label-item', item: ns.describe.describeElement(el, item) });
          const ms = Math.round(performance.now() - started);
          if (!result || result.error) return { result: result ?? { error: '응답이 없습니다.' }, ms };
          return { result, ms, final: ns.ai.finalLabel(el, result), needsName: item.needsName };
        },
        // 상세 이미지 읽기(detail.js)가 끝날 때까지 기다린다
        detailDone: () =>
          new Promise((resolve) => {
            const check = () => {
              const state = document.getElementById('ssucream-status')?.dataset.state;
              if (state === 'done' || state === 'error') resolve(state);
              else setTimeout(check, 300);
            };
            check();
          })
      };
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-text.js'] });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fns[name], args: [arg] });
      return result;
    },
    { url: page.url(), name, arg }
  );
}

async function openPage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  // 온글 content script(manifest)가 붙을 때까지 기다린다
  await page.waitForTimeout(500);
  return page;
}

// 상세 이미지를 먼저 읽어 결과 상자를 페이지에 넣는다 (--detail). 질문·요약이 그 내용까지 보게 된다.
async function readDetail(sw, page) {
  await scrollThrough(page);
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-text.js', 'content/detail.js'] });
  }, page.url());
  const state = await inTab(sw, page, 'detailDone');
  if (state !== 'done') throw new Error('상세 이미지 읽기 실패: --detail 없이 다시 돌리거나 상세 이미지 평가(npm run eval)로 원인을 확인하세요');
}

const clearCache = (sw) => sw.evaluate(() => chrome.storage.session.clear());

async function runQa(sw, page, run) {
  const { questions } = gold('qa');
  const rows = [];
  for (const q of questions) {
    await clearCache(sw);
    const { result, ms, paragraphs } = await inTab(sw, page, 'ask', { question: q.question });
    if (result?.error) {
      rows.push({ task: 'qa', run, id: q.id, ok: false, error: result.error });
      continue;
    }
    rows.push({ task: 'qa', run, id: q.id, ok: true, ms, question: q.question, ...result, ...scoreQuestion(q, result, { detail: args.detail, paragraphs }) });
  }
  return rows;
}

async function runSummary(sw, page, run) {
  await clearCache(sw);
  const { result, ms } = await inTab(sw, page, 'summarize');
  if (result?.error) return [{ task: 'summary', run, id: 'shop', ok: false, error: result.error }];
  return [{ task: 'summary', run, id: 'shop', ok: true, ms, overview: result.overview, items: result.items, score: scoreSummary(gold('summary'), result, { detail: args.detail }) }];
}

async function runLabels(context, sw, base, run) {
  const rows = [];
  for (const { page: pagePath, items } of gold('label').pages) {
    const page = await openPage(context, base + pagePath);
    try {
      for (const g of items) {
        await clearCache(sw);
        const { result, ms, final, needsName } = await inTab(sw, page, 'label', { selector: g.selector });
        if (result?.error) {
          rows.push({ task: 'label', run, id: g.id, ok: false, hint: g.hint, error: result.error });
          continue;
        }
        rows.push({ task: 'label', run, id: g.id, ok: true, ms, hint: g.hint, destructive: Boolean(g.destructive), truth: g.truth, label: result.label, confident: result.confident, final, needsName, ...scoreLabel(g, final) });
      }
    } finally {
      await page.close();
    }
  }
  return rows;
}

const pct = (v) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
const sec = (ms) => (ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}초`);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const p95 = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] : null;
};
const times = (rows) => rows.filter((r) => r.ok).map((r) => r.ms);

// 같은 항목의 반복 결과를 "맞음 3, 틀림 2"처럼 모은다
function tally(rows, task) {
  const byId = new Map();
  for (const r of rows.filter((x) => x.task === task)) {
    const key = `${r.provider}\u0000${r.id}`;
    const v = r.ok ? r.verdict : 'error';
    const entry = byId.get(key) ?? { provider: r.provider, id: r.id, counts: {}, sample: r };
    entry.counts[v] = (entry.counts[v] ?? 0) + 1;
    byId.set(key, entry);
  }
  return [...byId.values()];
}

const VERDICT = {
  correct: '맞음', wrong: '틀림', missed: '놓침', abstained: '모름(바름)', referred: '안내(바름)', fabricated: '지어냄',
  unsure: '맞음(확신 낮음)', warned: '용도 불명확 경고', error: '오류'
};
const tallyText = (counts) => Object.entries(counts).map(([v, n]) => `${VERDICT[v] ?? v} ${n}`).join(', ');

function report(providers, rows) {
  const lines = [];
  for (const provider of providers) {
    const mine = rows.filter((r) => r.provider === provider);
    lines.push(`\n## ${provider}`);
    const qa = mine.filter((r) => r.task === 'qa');
    if (qa.length) {
      const s = summarizeQa(qa);
      lines.push(
        '',
        '| 질문 응답 | 질문 | 오류 | 답 있는 질문 정답률 | 틀림 | 놓침 | 답 없는 질문 | 지어낸 답 | 근거 위치 정확도 | 중앙값 | p95 |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        `| A4 | ${s.asked} | ${s.errors} | ${pct(s.accuracy)} (${s.correct}/${s.answerable}) | ${s.wrong} | ${s.missed} | ${s.unanswerable} | **${s.fabricated}** | ${pct(s.evidenceAccuracy)} | ${sec(median(times(qa)))} | ${sec(p95(times(qa)))} |`
      );
    }
    const summary = mine.filter((r) => r.task === 'summary');
    if (summary.length) {
      const ok = summary.filter((r) => r.ok);
      const coverage = ok.length ? ok.reduce((a, r) => a + r.score.coverage, 0) / ok.length : null;
      const fabricated = ok.reduce((a, r) => a + r.score.fabricated.length, 0);
      lines.push(
        '',
        '| 요약 | 실행 | 오류 | 핵심 사실 포함 | 지어낸 내용(목록에 있는 것) | 근거 없는 항목 | 중앙값 | p95 |',
        '|---|---|---|---|---|---|---|---|',
        `| A3 | ${summary.length} | ${summary.length - ok.length} | ${pct(coverage)} | **${fabricated}** | ${ok.reduce((a, r) => a + r.score.itemsWithoutSource, 0)} | ${sec(median(times(summary)))} | ${sec(p95(times(summary)))} |`
      );
    }
    const label = mine.filter((r) => r.task === 'label');
    if (label.length) {
      const s = summarizeLabels(label);
      const hint = Object.entries(s.byHint).map(([h, v]) => `${h} ${v.right}/${v.total}`).join(', ');
      lines.push(
        '',
        '| 자동 보완 | 요소 | 오류 | 정답률 | 확신 낮음 | 경고 | 틀림 | 파괴적 요소 | 위험한 오답 | 헛경보 | 단서별 | 중앙값 | p95 |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        `| A1 | ${s.items} | ${s.errors} | ${pct(s.accuracy)} | ${s.unsure} | ${s.warned} | ${s.wrong} | ${s.destructive} | **${s.dangerous}** | ${s.falseAlarm} | ${hint} | ${sec(median(times(label)))} | ${sec(p95(times(label)))} |`
      );
    }
  }

  // 항목별 결과. 자동 채점이 틀릴 수 있으니(표현 차이) 사람이 "틀림·지어냄·놓침"을 읽고 확인한다
  lines.push('\n## 항목별 결과 (사람 확인용)');
  if (rows.some((r) => r.task === 'qa')) {
    lines.push('', '| 공급자 | 질문 | 결과(반복 합계) | 답(첫 실행) |', '|---|---|---|---|');
    for (const t of tally(rows, 'qa')) lines.push(`| ${t.provider} | ${t.sample.question ?? t.id} | ${tallyText(t.counts)} | ${t.sample.answer ?? t.sample.error} |`);
  }
  if (rows.some((r) => r.task === 'label')) {
    lines.push('', '| 공급자 | 요소 | 정답 | 결과(반복 합계) | 읽은 이름(첫 실행) |', '|---|---|---|---|---|');
    for (const t of tally(rows, 'label')) lines.push(`| ${t.provider} | ${t.id} | ${t.sample.truth ?? ''} | ${tallyText(t.counts)} | ${t.sample.final ?? t.sample.error} |`);
  }
  for (const r of rows.filter((x) => x.task === 'summary' && x.ok)) {
    lines.push(
      '',
      `요약 (${r.provider} ${r.run}회차): 빠진 사실 ${r.score.missing.join(', ') || '없음'} / 지어낸 말 ${r.score.fabricated.join(', ') || '없음'}`,
      `- 개요: ${r.overview}`,
      ...r.items.map((i) => `- ${i.text} (근거 ${i.sources.join(', ') || '없음'})`)
    );
  }
  return lines.join('\n');
}

async function main() {
  const providers = chooseProviders(args);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssucream-ai-eval-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: !args.headed,
    locale: 'ko-KR',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
  });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOptionsTab(context);
    const startedAt = new Date();
    const models = {};
    const rows = [];
    for (const provider of providers) {
      const settings = { aiEnabled: true, ...providerSettings(provider, `${base}/mock/v1`) };
      models[provider] = modelOf(settings);
      await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
      for (let run = 1; run <= REPEAT; run++) {
        const note = REPEAT > 1 ? ` (${run}/${REPEAT})` : '';
        if (tasks.includes('label')) {
          console.error(`[${provider}] 자동 보완${note}`);
          rows.push(...(await runLabels(context, sw, base, run)).map((r) => ({ provider, ...r })));
        }
        if (tasks.includes('qa') || tasks.includes('summary')) {
          const page = await openPage(context, `${base}${gold('qa').page}`);
          try {
            if (args.detail) {
              console.error(`[${provider}] 상세 이미지 먼저 읽기${note}`);
              await clearCache(sw);
              await readDetail(sw, page);
            }
            if (tasks.includes('qa')) {
              console.error(`[${provider}] 질문 응답${note}`);
              rows.push(...(await runQa(sw, page, run)).map((r) => ({ provider, ...r })));
            }
            if (tasks.includes('summary')) {
              console.error(`[${provider}] 요약${note}`);
              rows.push(...(await runSummary(sw, page, run)).map((r) => ({ provider, ...r })));
            }
          } finally {
            await page.close();
          }
        }
      }
    }

    const meta = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ...gitVersion(),
      models,
      repeat: REPEAT,
      tasks,
      detail: args.detail,
      gold: Object.fromEntries(TASKS.map((t) => [t, gold(t).status])),
      headed: args.headed,
      chromium: await chromiumVersion(sw),
      node: process.version
    };
    const resultsDir = path.join(here, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const file = path.join(resultsDir, `ai-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ meta, rows }, null, 2));
    const modelText = Object.entries(models).map(([p, m]) => `${p} ${m}`).join(', ');
    console.error(`\n코드 ${meta.commit ?? '알 수 없음'}${meta.dirty ? ' (커밋하지 않은 변경 있음)' : ''}, 모델 ${modelText}, ${REPEAT}회${args.detail ? ', 상세 이미지 읽은 뒤' : ''}`);
    console.log(report(providers, rows));
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
