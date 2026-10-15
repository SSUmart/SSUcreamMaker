// F4 내용 요약, F5 질문 응답 E2E 점검: 가짜 AI 서버(키 불필요)와 평가용 쇼핑몰로 실제 Chromium에서
// 본문 수집, 요약 상자, 원문 이동, 질문 대화상자, 포커스 이동, 캐시, 기존 상세 이미지 읽기를 확인한다.
// 사용법: eval 폴더에서 npm run e2e  (스크린샷과 AI에 보낸 글은 eval/results/e2e/에 저장)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from './shop/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const OUT = path.join(here, 'results', 'e2e');
fs.mkdirSync(OUT, { recursive: true });
const prompts = [];
const num = (prompt, word) => {
  const line = prompt.split('\n').find((l) => /^\[\d+\]/.test(l) && l.includes(word));
  return line ? Number(line.match(/^\[(\d+)\]/)[1]) : 999;
};
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/mock/v1/chat/completions') {
    let body = '';
    for await (const c of req) body += c;
    const prompt = JSON.parse(body).messages[0].content;
    let content;
    // 상세 이미지 읽기(F2) 요청: 조각 글자 읽기, 정리
    if (Array.isArray(prompt)) content = '정가 39,000원';
    else if (prompt.startsWith('쇼핑몰 상품 상세')) content = '{"sections":[{"title":"가격·할인","items":["정가 39,000원"]}]}';
    // 요약·질문 요청: 실제 프롬프트에서 근거 문단 번호를 찾아 답한다
    else if (prompts.push(prompt) && prompt.startsWith('다음 웹페이지 글을 요약하세요')) {
      content = '```json\n' + JSON.stringify({
        overview: '진공 텀블러 상품 페이지입니다.',
        items: [
          { text: '판매가 24,900원 (정가 32,000원, 22% 할인)', sources: [num(prompt, '24,900')] },
          { text: '배송비 3,000원, 30,000원 이상 무료', sources: [num(prompt, '배송비')] },
          { text: '탄산음료는 권하지 않음', sources: [num(prompt, '탄산')] },
          { text: '근거 없는 항목', sources: [999] }
        ]
      }) + '\n```';
    } else {
      content = prompt.trimEnd().split('\n').at(-1).startsWith('질문: 탄산')
        ? JSON.stringify({ found: true, answer: '압력 때문에 탄산음료는 권하지 않습니다.', sources: [num(prompt, '탄산')] })
        : JSON.stringify({ found: false, answer: '', sources: [] });
    }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }
  if (serveShop(req, res)) return;
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), {
  channel: 'chromium', headless: true, locale: 'ko-KR', viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const inject = (files) => sw.evaluate(async (files) => {
  const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
}, files);
const page = await ctx.newPage();
await page.goto(`${base}/shop/`);
for (const p of ctx.pages()) if (p.url().includes('options')) await p.close();
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1; };
const focusedText = () => page.evaluate(() => document.activeElement?.textContent.trim().slice(0, 60));

// 1) AI 꺼짐 → 실패 상자가 남고 포커스
await inject(['content/page-text.js', 'content/summary.js']);
await page.waitForSelector('#ssucream-summary-title:text("페이지 요약 실패")');
check('AI 꺼짐: 실패 상자', (await page.textContent('#ssucream-summary')).includes('AI 기능이 꺼져 있습니다'));
check('AI 꺼짐: 실패 제목에 포커스', (await focusedText()) === '페이지 요약 실패');

// 2) 요약
await sw.evaluate((b) => chrome.storage.local.set({ settings: { aiEnabled: true, provider: 'nim', nim: { apiKey: 'mock', model: 'mock', baseUrl: b } } }), `${base}/mock/v1`);
await inject(['content/page-text.js', 'content/summary.js']);
await page.waitForSelector('#ssucream-summary-title:text("페이지 요약, AI 생성")');
const p0 = prompts[0];
check('수집: 가격·배송비 포함', p0.includes('24,900원') && p0.includes('배송비'));
check('수집: 닫힌 탭(상품문의) 포함', p0.includes('탄산수'));
check('수집: 머리말·꼬리말·메뉴 제외', !p0.includes('주 메뉴') && !p0.includes('이용약관') && !p0.includes('기획전'));
check('수집: 표는 행 단위', /\] 배송비 3,000원, 30,000원 이상 구매 시 무료/.test(p0) || /\] 배송비 +3,000원/.test(p0));
fs.writeFileSync(path.join(OUT, 'summary-prompt.txt'), p0);
check('요약: 화면에 보임', await page.isVisible('#ssucream-summary'));
check('요약: 제목에 포커스', (await focusedText()) === '페이지 요약, AI 생성');
const buttons = await page.$$eval('#ssucream-summary li button', (b) => b.map((x) => x.textContent));
check('요약: 근거 없는 항목엔 버튼 없음', buttons.length === 3 && buttons[2] === '3번 원문으로 이동');
check('요약: 상세 이미지 미포함 안내', (await page.textContent('#ssucream-summary')).includes('온글 키와 D'));
await page.screenshot({ path: path.join(OUT, 'summary.png') });
await page.click('#ssucream-summary li:nth-child(3) button');
check('원문 이동: 닫힌 상품문의 탭이 열림', await page.isVisible('#panel-qna'));
check('원문 이동: 근거 문단에 포커스', (await focusedText()).includes('탄산수'));

// 3) 질문 응답
await inject(['content/page-text.js', 'content/qa.js']);
await page.waitForSelector('#ssucream-qa[open]');
check('질문: 입력창에 포커스', await page.evaluate(() => document.activeElement.id === 'ssucream-qa-input'));
await page.click('#ssucream-qa button[type=submit]');
check('질문: 빈 질문 오류 표시', (await page.textContent('#ssucream-qa-error')).includes('입력해주세요'));
await page.fill('#ssucream-qa-input', '탄산 음료 담아도 돼?');
await page.press('#ssucream-qa-input', 'Enter');
await page.waitForSelector('#ssucream-qa li p:text("AI 답변")');
check('질문: 답 문단에 포커스', (await focusedText()).startsWith('답변: 압력 때문에'));
await page.fill('#ssucream-qa-input', '각인 색상은?');
await page.press('#ssucream-qa-input', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('#ssucream-qa li').length === 2 && document.querySelector('#ssucream-qa li:last-child p:nth-of-type(2)') && !document.querySelector('#ssucream-qa li:last-child p:nth-of-type(2)').textContent.includes('찾는 중'));
check('질문: 없는 답은 찾지 못함', (await focusedText()).includes('페이지에서 찾지 못했습니다'));
check('질문: 이전 대화가 프롬프트에 포함', prompts.at(-1).includes('이전 대화:\n질문: 탄산 음료 담아도 돼?'));
check('질문: 요약 상자 내용은 수집 안 함', !prompts.at(-1).includes('페이지 요약, AI 생성'));
await page.screenshot({ path: path.join(OUT, 'qa.png') });
await page.click('#ssucream-qa li:first-child button');
check('근거 이동: 대화상자 닫힘', !(await page.isVisible('#ssucream-qa')));
check('근거 이동: 근거에 포커스', (await focusedText()).includes('탄산수'));
await inject(['content/page-text.js', 'content/qa.js']);
check('다시 열기: 기록 유지', (await page.$$('#ssucream-qa li')).length === 2);
const cachedCount = prompts.length;
await page.keyboard.press('Escape');
await inject(['content/page-text.js', 'content/summary.js']);
await page.waitForSelector('#ssucream-summary-title:text("페이지 요약, AI 생성")');
check('요약 캐시: 같은 페이지면 AI 다시 안 부름', prompts.length === cachedCount);

// 4) 상세 이미지 읽기(F2) 기존 동작
await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.scrollBy(0, 600); await new Promise((r) => setTimeout(r, 100)); } });
await inject(['content/detail.js']);
await page.waitForFunction(() => ['done', 'error'].includes(document.getElementById('ssucream-status')?.dataset.state), null, { timeout: 60000 });
check('F2 기존 동작 유지', await page.evaluate(() => document.getElementById('ssucream-status').dataset.state === 'done'));
await ctx.close();
server.close();
console.log(process.exitCode ? '\n실패한 항목이 있습니다.' : `\n모두 통과. 스크린샷: ${path.relative(process.cwd(), OUT)}`);
