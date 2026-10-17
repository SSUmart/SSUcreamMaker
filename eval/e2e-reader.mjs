// 온글 스크린리더 E2E 점검: 실제 Chromium에 확장을 올리고, 평가용 쇼핑몰과 가짜 AI 서버, 가짜 음성으로
// 읽기·이동·메뉴·사용 가이드·AI 자동 보완·AI 결과 모음·요약·질문·상세 이미지·점자 전달·설정 화면을 확인한다.
// 음성은 서비스 워커의 chrome.tts를 가짜로 바꿔(소리 없이 바로 끝남) 화면 자막으로 확인한다.
// 사용법: eval 폴더에서 npm run e2e:reader   (API 키 불필요. 스크린샷은 eval/results/e2e-reader/)
//        실제 음성으로 듣기: npm run e2e:reader -- --headed --real-voice
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from './shop/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const OUT = path.join(here, 'results', 'e2e-reader');
fs.mkdirSync(OUT, { recursive: true });
const headed = process.argv.includes('--headed');
// --real-voice: 가짜 음성 대신 실제 음성으로 읽는다 (--headed와 함께, 소리가 남)
const realVoice = process.argv.includes('--real-voice');

// 가짜 AI: 요청 종류(프롬프트 첫머리)와 요소 단서로 정해진 답을 돌려준다
function fakeAi(content) {
  if (Array.isArray(content)) return '식기세척기를 사용하지 마세요. 오후 2시 이전 주문은 당일 출고.';
  if (content.startsWith('쇼핑몰 상품 상세')) {
    return JSON.stringify({ sections: [{ title: '주의사항', items: ['식기세척기를 사용하지 마세요.'] }, { title: '배송·교환·반품', items: ['오후 2시 이전 주문은 당일 출고'] }] });
  }
  if (content.startsWith('웹페이지에 이름이 없어')) {
    const label =
      content.includes('btn-share') ? '공유하기' :
      content.includes('btn-delete') ? (content.includes('fixture-wrong') ? '찜하기' : '옵션 초기화') :
      content.includes('btn-like') ? '도움돼요' :
      content.includes('top-btn') ? '맨 위로' :
      content.includes('product-colors') ? '세 가지 색상 텀블러 사진' : '이름 후보';
    return JSON.stringify({ label, confident: true });
  }
  if (content.startsWith('시각장애인 사용자가 웹페이지에서')) return '{"description":"상품 링크를 공유하는 버튼입니다."}';
  if (content.startsWith('다음 웹페이지 글을 요약하세요')) {
    return JSON.stringify({ overview: '진공 텀블러 상품 페이지입니다.', items: [{ text: '판매가 24,900원', sources: [] }, { text: '식기세척기 사용 불가', sources: [] }] });
  }
  return JSON.stringify({ found: true, answer: '배송비는 3,000원입니다.', sources: [] });
}

const FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>교차 검증 확인</title></head><body><main>
<h1>교차 검증 확인</h1><p>fixture-wrong</p>
<button class="btn-delete"><svg width="20" height="20" aria-hidden="true"><rect width="10" height="10"/></svg></button>
<p>끝</p></main></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/mock/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const content = JSON.parse(body).messages[0].content;
    // 자동 보완 이름은 조금 늦게 와야 "분석 중" 안내를 확인할 수 있다
    if (typeof content === 'string' && content.startsWith('웹페이지에 이름이 없어')) await new Promise((r) => setTimeout(r, 600));
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ choices: [{ message: { content: fakeAi(content) } }] }));
  }
  if (req.url === '/fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(FIXTURE);
  }
  if (!serveShop(req, res)) {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ongeul-e2e-')), {
  channel: 'chromium',
  headless: !headed,
  viewport: { width: 1280, height: 860 },
  locale: 'ko-KR',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
// 가짜 음성: 대기열과 끊기를 흉내 내고 바로 끝낸다
if (!realVoice) await sw.evaluate(async () => {
  // chrome.tts는 서비스 워커가 뜬 뒤 조금 늦게 생기고, 생기기 전에 넣은 가짜는 덮어써진다. 생긴 뒤에 객체째 바꾼다.
  for (let i = 0; i < 100 && !chrome.tts; i++) await new Promise((r) => setTimeout(r, 50));
  const tts = { onEvent: chrome.tts?.onEvent };
  Object.defineProperty(chrome, 'tts', { value: tts, writable: true, configurable: true });
  const queue = [];
  let current = null;
  const finish = (item, type) => {
    clearTimeout(item.timer);
    item.onEvent?.({ type });
  };
  const next = () => {
    if (current || !queue.length) return;
    current = queue.shift();
    current.onEvent?.({ type: 'start' });
    current.timer = setTimeout(() => {
      const done = current;
      current = null;
      finish(done, 'end');
      next();
    }, 40 + done_length(current.text));
  };
  const done_length = (text) => Math.min(400, text.length * 2);
  chrome.tts.getVoices = async () => [{ voiceName: '가짜 음성', lang: 'ko-KR' }];
  chrome.tts.speak = (text, options = {}) => {
    if (!options.enqueue) {
      queue.splice(0).forEach((item) => finish(item, 'cancelled'));
      if (current) finish(current, 'interrupted');
      current = null;
    }
    queue.push({ text, onEvent: options.onEvent });
    next();
    return Promise.resolve();
  };
  chrome.tts.stop = () => {
    queue.splice(0).forEach((item) => finish(item, 'cancelled'));
    if (current) finish(current, 'interrupted');
    current = null;
  };
});
await new Promise((r) => setTimeout(r, 800));
const welcomeSeen = (await sw.evaluate(() => chrome.storage.local.get('guidanceSeen'))).guidanceSeen?.welcome ?? 0;
for (const p of ctx.pages()) if (p.url().includes('options')) await p.close();

const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` | ${String(detail).slice(0, 240)}` : ''}`);
};
const shadow = (fn) => page.evaluate(`(() => { const r = document.querySelector('[data-ongeul-ui]')?.shadowRoot; return r ? (${fn})(r) : null; })()`);
const caption = async () => (await shadow((r) => r.querySelector('.caption span:last-child')?.textContent ?? '')) ?? '';
const press = async (key, wait = 250) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(wait);
  return caption();
};
// 조건에 맞는 자막이 나올 때까지 기다린다. 못 찾으면 그동안 본 자막들을 돌려준다(실패 원인 확인용).
// 실제 음성은 문장마다 몇 초씩 걸리므로 기다리는 시간을 늘린다
const until = async (test, timeout = 5000) => {
  const end = Date.now() + timeout * (realVoice ? 4 : 1);
  const seen = [];
  while (Date.now() < end) {
    const c = await caption();
    if (test(c)) return c;
    if (seen.at(-1) !== c) seen.push(c);
    await page.waitForTimeout(80);
  }
  return `(못 찾음) ${seen.join(' / ')}`;
};
const toItem = async (key, text, limit = 40) => {
  await press('Control+Home', 150);
  for (let i = 0; i < limit; i++) {
    const c = await press(key, 120);
    if (c.includes(text)) return c;
  }
  return caption();
};

console.log('== 시작 안내');
check('설치 직후 시작 안내를 만듦', welcomeSeen >= 1, `welcome ${welcomeSeen}회`);

console.log('\n== 켜기, 읽기, 이동');
await page.goto(`${base}/shop/`);
await page.waitForTimeout(500);
await sw.evaluate(() => chrome.storage.local.set({ readerEnabled: true }));
let c = await until((t) => t.includes('온글이 켜졌습니다'));
check('켜기 안내 (사용 가이드 위치 포함)', c.includes('온글이 켜졌습니다') && c.includes('사용 가이드'), c);
check('아래 화살표: 첫 항목', (await press('ArrowDown')).includes('본문 바로가기, 링크'));
check('H: 제목', (await press('KeyH')).includes('제목 1'));
check('R → Enter: 라디오 선택', (await press('KeyR')).includes('1/3') && (await press('Enter', 400)).includes('선택됨'));
check('E → Enter: 글쓰기 모드', (await press('KeyE')).includes('수량') && (await press('Enter', 400)).includes('글쓰기 모드'));
check('Esc: 읽기 모드', (await press('Escape', 400)).includes('읽기 모드'));
check('Shift+T: 표', (await toItem('KeyT', '표,')).includes('5행 2열'));
await toItem('KeyH', '상세정보, 제목 2');
c = await press('ArrowDown');
check('상세 이미지 자리 안내 (실제 키 이름)', c.includes('상세 이미지 4개') && c.includes('Shift와 D 키'), c);
check('Alt+Shift+1: 도움말 (실제 키 이름)', ((c) => c.includes('Shift와 A') && !c.includes('온글 키와'))(await press('Alt+Shift+Digit1')));

console.log('\n== 온글 메뉴와 사용 가이드');
c = await press('Alt+Shift+KeyM', 400);
check('메뉴 첫 항목은 사용 가이드', c.includes('온글 메뉴') && c.includes('1번, 사용 가이드'), c);
c = await press('Enter', 400);
check('사용 가이드 목차', c.includes('온글 사용 가이드 목차') && c.includes('1장, 온글은 무엇인가요'), c);
c = await press('Enter', 400);
check('1장 열기: 제목과 첫 문단', c.includes('사용 가이드 1장, 온글은 무엇인가요') && c.includes('스크린리더입니다'), c);
check('가이드 화면 표시', await shadow((r) => r.querySelector('.guide') && !r.querySelector('.guide').hidden));
await page.screenshot({ path: path.join(OUT, 'guide.png') });
check('아래 화살표: 다음 문단', (await press('ArrowDown')).includes('이름 없는 버튼'));
await press('End');
check('장 끝에서 아래 화살표: 다음 장', (await press('ArrowDown')).includes('2장, 켜고 끄기'));
check('Esc: 목차로', (await press('Escape', 400)).includes('온글 사용 가이드 목차'));
await press('Escape', 300);
check('Esc 두 번: 메뉴 닫힘', (await press('Escape', 300)).includes('메뉴를 닫았습니다'));

console.log('\n== AI 자동 보완 (가짜 AI)');
await sw.evaluate((url) => chrome.storage.local.set({ settings: { aiEnabled: true, provider: 'nim', nim: { apiKey: 'mock', model: 'mock', baseUrl: url } } }), `${base}/mock/v1`);
await page.reload();
await page.waitForTimeout(600);
c = await toItem('KeyB', '이름 없음, 버튼', 6);
check('이름 없는 공유 버튼: 이름 없음 + AI 분석 중', c.startsWith('이름 없음, 버튼') || (await until((t) => t.includes('AI'), 1500)).includes('AI'), c);
c = await until((t) => t.includes('분석 결과') || t.includes('공유하기'), 4000);
check('그 자리에 있으면 결과를 읽음', c.includes('공유하기, AI 추정, 버튼'), c);
await page.waitForTimeout(3500); // 미리 분석
check('옵션 초기화 버튼', (await toItem('KeyB', '초기화')).includes('옵션 초기화, AI 추정, 버튼'), await caption());
check('div 맨 위로 버튼', (await toItem('KeyB', '맨 위로', 60)).includes('맨 위로, AI 추정, 버튼'), await caption());
c = await press('Alt+Shift+KeyI', 500);
check('AI 결과 모음', c.includes('AI 결과 모음') && c.includes('AI 추정'), c);
await press('Escape', 300);
await press('Escape', 300);
await toItem('KeyB', '공유하기');
c = await press('Alt+Shift+KeyE', 1200);
check('현재 항목 AI 설명', (await until((t) => t.includes('AI 설명'), 3000)).includes('상품 링크를 공유하는 버튼입니다'), c);

console.log('\n== 교차 검증');
await page.goto(`${base}/fixture/`);
await page.waitForTimeout(500);
await toItem('KeyB', '버튼', 3);
c = await until((t) => t.includes('용도 불명확'), 4000);
check('삭제 단서와 다른 AI 이름은 용도 불명확', c.includes('용도 불명확, delete 관련일 수 있음'), c);

console.log('\n== 요약·질문·상세 이미지');
await page.goto(`${base}/shop/`);
await page.waitForTimeout(600);
await page.evaluate(async () => {
  for (let i = 0; i < 30; i++) {
    window.scrollBy(0, 600);
    await new Promise((r) => setTimeout(r, 40));
  }
  window.scrollTo(0, 0);
});
await press('Alt+Shift+KeyS', 300);
// 첫 문장(개요)은 가짜 음성에서 너무 빨리 지나가므로 그다음 안내 문장으로 확인한다
c = await until((t) => t.includes('AI가 페이지 글을 요약했습니다'), 6000);
check('요약 결과를 바로 읽음 (대화상자)', !c.startsWith('(못 찾음)') && (await page.evaluate(() => document.querySelector('#ssucream-summary')?.open)), c);
await press('Control', 200);
// 읽던 위치가 초점을 받지 않는 제목이어도(초점은 앞의 링크에 남음) Esc로 닫으면 그 제목으로 돌아온다
await press('Escape', 300);
await toItem('KeyH', '상세정보, 제목 2');
await press('Alt+Shift+KeyS', 600);
await press('Control', 200);
c = await press('Escape', 500);
check('요약 Esc: 읽던 위치로 돌아옴', c.includes('상세정보, 제목 2'), c);
await press('Alt+Shift+KeyD', 300);
c = await until((t) => t.includes('식기세척기'), 10000);
check('상세 이미지 결과를 바로 읽음', !c.startsWith('(못 찾음)'), c);
await press('Control', 200);
await press('Alt+Shift+KeyQ', 600);
await page.keyboard.type('배송비 얼마야');
await press('Enter', 300);
check('질문 답을 읽음', (await until((t) => t.includes('배송비는 3,000원입니다'), 5000)).includes('AI 답변'));
await press('Escape', 300);

console.log('\n== 점자 전달 테스트');
await sw.evaluate(() => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, braille: { adminTools: true } } })));
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-ongeul-ui]').shadowRoot.querySelector('.braille-toggle').click());
await press('ArrowDown', 300);
const rows = await shadow((r) => Object.fromEntries([...r.querySelectorAll('.braille-panel tr')].map((tr) => [tr.querySelector('th').textContent, tr.querySelector('td').textContent])));
check('점자 전달 결과: 40바이트 성공', rows?.['전송 결과']?.startsWith('성공: 기기가 40칸을 받음'), rows?.['전송 결과']);
await page.screenshot({ path: path.join(OUT, 'braille.png') });

console.log('\n== 설정 화면');
const id = new URL(sw.url()).host;
const options = await ctx.newPage();
options.on('pageerror', (e) => errors.push(`설정: ${e.message}`));
await options.goto(`chrome-extension://${id}/options/options.html`);
await options.waitForTimeout(1200);
check('설정 화면: 시작하기', (await options.textContent('#start-toggle'))?.includes('온글을 켭니다'));
check('설정 화면: 사용 가이드 전체', (await options.$$eval('#guide-text h3', (h) => h.length)) >= 9);
const optionsCaption = await options.evaluate(() => document.querySelector('[data-ongeul-ui]')?.shadowRoot?.querySelector('.caption span:last-child')?.textContent ?? '');
check('설정 화면도 온글이 읽음', optionsCaption.includes('온글 설정'), optionsCaption);
await options.close();

console.log('\n== 끄기');
await sw.evaluate(() => chrome.storage.local.set({ readerEnabled: false }));
await page.waitForTimeout(500);
check('끄면 온글 화면이 사라짐', await page.evaluate(() => !document.querySelector('[data-ongeul-ui]')));

console.log(`\n합계: 통과 ${pass}, 실패 ${fail}`);
console.log(errors.length ? `페이지 오류: ${errors.join(' | ')}` : '페이지 오류: 없음');
console.log(`스크린샷: ${path.relative(process.cwd(), OUT)}`);
if (fail || errors.length) process.exitCode = 1;
await ctx.close();
server.close();
