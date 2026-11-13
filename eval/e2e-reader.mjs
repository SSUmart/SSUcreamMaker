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
  if (Array.isArray(content)) {
    // 그림을 함께 보낸 이름 짓기 요청은 글 부분으로 답한다
    const text = content.find((part) => part.type === 'text')?.text ?? '';
    if (text.startsWith('웹페이지에 이름이 없어')) return fakeAi(text);
    return '식기세척기를 사용하지 마세요. 오후 2시 이전 주문은 당일 출고.';
  }
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

// E 키 편집창 이동: 자동완성 검색창(role="combobox"인 입력칸)도 편집창으로 찾는지. 네이버·유튜브 검색창과 같은 마크업
const SEARCH_FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>검색창 확인</title></head><body><main>
<h1>검색창 확인</h1>
<label for="sort">정렬</label><select id="sort"><option>최신순</option><option>인기순</option></select>
<input id="query" type="search" name="query" title="네이버 검색" placeholder="검색어를 입력해 주세요." role="combobox" aria-expanded="false" aria-autocomplete="list">
<button type="button">버튼 사이</button>
<input name="search_query" aria-label="유튜브 검색" role="combobox" aria-autocomplete="list" aria-expanded="false">
<p>끝</p></main></body></html>`;

// 고른 항목 알림: 초점은 상자에 두고 가리키는 항목(aria-activedescendant)이나 값만 바꾸는 목록 (초점 이동이 없음)
const CHOICE_FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>항목 선택 확인</title></head><body><main>
<h1>항목 선택 확인</h1>
<label for="color">색상</label><select id="color"><option>고르세요</option><option>블랙</option><option>화이트</option></select>
<span id="fl">과일</span><ul role="listbox" tabindex="0" aria-labelledby="fl" id="lb" aria-activedescendant="o1">
<li role="option" id="o1" aria-selected="true">사과</li><li role="option" id="o2" aria-selected="false">배</li><li role="option" id="o3" aria-selected="false">귤</li></ul>
<label for="cb">도시</label><input id="cb" role="combobox" aria-expanded="false" aria-controls="cl" aria-autocomplete="list">
<ul role="listbox" id="cl" hidden><li role="option" id="c1">서울</li><li role="option" id="c2">부산</li></ul>
<p>끝</p></main>
<script>
const lb = document.getElementById('lb'), opts = [...lb.children]; let i = 0;
lb.addEventListener('keydown', (e) => { if (!/Arrow(Up|Down)/.test(e.key)) return; e.preventDefault();
  i = Math.max(0, Math.min(2, i + (e.key === 'ArrowDown' ? 1 : -1))); opts.forEach((o, k) => o.setAttribute('aria-selected', k === i)); lb.setAttribute('aria-activedescendant', opts[i].id); });
const cb = document.getElementById('cb'), cl = document.getElementById('cl'), cs = [...cl.children]; let j = -1;
const open = (v) => { cl.hidden = !v; cb.setAttribute('aria-expanded', String(v)); };
cb.addEventListener('input', () => { open(cb.value.length > 0); j = -1; cb.removeAttribute('aria-activedescendant'); });
cb.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); open(true); j = Math.min(1, j + 1); cs.forEach((o, k) => o.setAttribute('aria-selected', k === j)); cb.setAttribute('aria-activedescendant', cs[j].id); }
  if (e.key === 'Enter' && j >= 0) { e.preventDefault(); cb.value = cs[j].textContent; open(false); cb.removeAttribute('aria-activedescendant'); j = -1; }
});
</script></body></html>`;

// 고른 옵션 알림: 쇼핑몰이 직접 만든 옵션. 고른 칸을 클래스로만 표시하는 버튼(사이즈), 목록 항목에 표시가 붙는 버튼(색상),
// 가리키는 항목이 따로 없는 목록 상자의 aria-selected, 모두 같은 클래스가 붙은 꾸밈 버튼(선택으로 보지 않음)
const OPTION_FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>옵션 선택 확인</title></head><body><main>
<h1>옵션 선택 확인</h1>
<p>사이즈</p><div class="sizes"><button type="button" class="size">S</button><button type="button" class="size on">M</button><button type="button" class="size">L</button></div>
<p>색상</p><ul class="colors"><li class="is-selected"><button type="button">빨강</button></li><li><button type="button">파랑</button></li></ul>
<p>배송</p><ul role="listbox" aria-label="배송 방법"><li role="option" aria-selected="false">일반 배송</li><li role="option" aria-selected="true">빠른 배송</li></ul>
<p>꾸밈</p><div><button type="button" class="active">하나</button><button type="button" class="active">둘</button></div>
<p>끝</p></main>
<script>
document.querySelectorAll('.size').forEach((b) => b.addEventListener('click', () => document.querySelectorAll('.size').forEach((x) => x.classList.toggle('on', x === b))));
document.querySelectorAll('.colors button').forEach((b) => b.addEventListener('click', () => document.querySelectorAll('.colors li').forEach((li) => li.classList.toggle('is-selected', li === b.parentElement))));
</script></body></html>`;

// 버튼·입력 요소 목록: 상품마다 같은 이름의 버튼(장바구니 담기)은 앞 제목으로, 같은 제목 아래 같은 이름(삭제)은 순서로 구분한다
const ACTION_FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>버튼 목록 확인</title></head><body><main>
<h1>버튼 목록 확인</h1>
<h2>스텐 텀블러</h2><button type="button">장바구니 담기</button>
<h2>면 양말</h2><button type="button">장바구니 담기</button><button type="button">찜하기</button>
<h2>담은 상품</h2><button type="button">삭제</button><button type="button">삭제</button>
<label>쿠폰 번호 <input type="text"></label><label><input type="checkbox"> 선물 포장</label>
<p>끝</p></main></body></html>`;

// 이름 짓기 요청 글 (같은 모양 항목을 한 번만 묻는지 센다)
const labelCalls = [];
// 같은 모양 항목·단서 없는 항목 확인 페이지: 앞의 이름 없는 버튼 5개(도움돼요 3개 + 다른 모양 2개)는 페이지를 열 때 미리 분석되고,
// 맨 뒤 버튼은 미리 분석 범위(앞쪽 5개) 밖이라 가서 읽을 때 분석한다
const LIKE = '<button type="button" class="btn-like icon-btn"><svg width="16" height="16" aria-hidden="true"><path d="M2 7h3v7H2z"/></svg></button>';
const SHAPE_FIXTURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>같은 모양 확인</title></head><body>
<h1>같은 모양 확인</h1><p>리뷰 1</p>${LIKE}<p>리뷰 2</p>${LIKE}<p>리뷰 3</p>${LIKE}
<button type="button" class="icon-btn alpha-btn"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4"/></svg></button>
<button type="button" class="icon-btn beta-btn"><svg width="10" height="10" aria-hidden="true"><rect width="8" height="8"/></svg></button>
<p>끝 문단</p><button type="button" class="icon-btn mystery-btn"><svg width="10" height="10" aria-hidden="true"><path d="M1 1h8v8z"/></svg></button>
</body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/mock/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const content = JSON.parse(body).messages[0].content;
    const prompt = typeof content === 'string' ? content : content.find?.((part) => part.type === 'text')?.text ?? '';
    if (prompt.startsWith('웹페이지에 이름이 없어')) labelCalls.push(prompt);
    // 자동 보완 이름은 조금 늦게 와야 "분석 중" 안내를 확인할 수 있다
    if (typeof content === 'string' && content.startsWith('웹페이지에 이름이 없어')) await new Promise((r) => setTimeout(r, 600));
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ choices: [{ message: { content: fakeAi(content) } }] }));
  }
  if (req.url === '/choice-fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(CHOICE_FIXTURE);
  }
  if (req.url === '/action-fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(ACTION_FIXTURE);
  }
  if (req.url === '/option-fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(OPTION_FIXTURE);
  }
  if (req.url === '/search-fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(SEARCH_FIXTURE);
  }
  if (req.url === '/shape-fixture/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(SHAPE_FIXTURE);
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
// 처음 켜면 새 탭을 google.com으로 바꾼 이유를 알리고 되돌릴지 한 번 묻는다. Esc는 그대로 쓰기
c = await until((t) => t.includes('되돌릴까요'));
check('처음 켜면 새 탭 질문 (google.com 대신 구글 페이지)', c.includes('구글 페이지') && !c.includes('google.com') && c.includes('되돌릴까요') && c.includes('2개 중 1번'), c);
check('새 탭 질문 Esc: 구글 페이지 그대로', (await press('Escape', 400)).includes('계속 구글 페이지'));
check('아래 화살표: 첫 항목', (await press('ArrowDown')).includes('본문 바로가기, 링크'));
check('H: 제목', (await press('KeyH')).includes('제목 1'));
check('R → Enter: 라디오 선택', (await press('KeyR')).includes('1/3') && (await press('Enter', 400)).includes('선택됨'));
check('E → Enter: 글쓰기 모드', (await press('KeyE')).includes('수량') && (await press('Enter', 400)).includes('글쓰기 모드'));
check('Esc: 읽기 모드', (await press('Escape', 400)).includes('읽기 모드'));
check('Shift+T: 표', (await toItem('KeyT', '표,')).includes('5행 2열'));
await toItem('KeyH', '상세정보, 제목 2');
c = await press('ArrowDown');
check('상세 이미지 자리 안내 (실제 키 이름)', c.includes('상세 이미지 4개') && c.includes('Shift와 D 키'), c);
// 키 도움말은 목록으로 열리고 위아래 화살표로 하나씩 듣는다. Esc로 닫는다
c = await press('Alt+Shift+Digit1', 400);
check('Alt+Shift+1: 키 도움말 목록', c.includes('키 도움말') && /\d+개 중 1번/.test(c), c);
for (let i = 0; i < 12 && !c.includes('계속 읽기'); i++) c = await press('ArrowDown', 120);
check('키 도움말 아래 화살표: 한 항목씩 (실제 키 이름)', c.includes('계속 읽기') && c.includes('Shift와 A') && !c.includes('온글 키와'), c);
await press('Escape', 300);
check('키 도움말 Esc: 닫힘', !(await shadow((r) => r.querySelector('.menu') && !r.querySelector('.menu').hidden)));

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
// 요소 단서(btn-share)가 확실하면 AI를 기다리지 않고 바로 "추정"으로 읽는다
c = await toItem('KeyB', '공유하기', 6);
check('단서로 바로 이름: 공유 버튼 (AI 없이 "추정")', c.includes('공유하기, 추정, 버튼') && !c.includes('AI'), c);
check('단서로 이름을 붙인 버튼은 AI에 묻지 않음', !labelCalls.some((t) => t.includes('btn-share')), String(labelCalls.length));
await page.waitForTimeout(3500); // 미리 분석
check('옵션 초기화 버튼 (삭제 단서라 AI 교차 검증)', (await toItem('KeyB', '초기화')).includes('옵션 초기화, AI 추정, 버튼'), await caption());
check('div 맨 위로 버튼 (단서 top-btn)', (await toItem('KeyB', '맨 위로', 60)).includes('맨 위로, 추정, 버튼'), await caption());
c = await press('Alt+Shift+KeyI', 500);
check('AI 결과 모음', c.includes('AI 결과 모음') && c.includes('AI 추정'), c);
await press('Escape', 300);
await press('Escape', 300);
await toItem('KeyB', '공유하기');
c = await press('Alt+Shift+KeyE', 1200);
check('현재 항목 AI 설명', (await until((t) => t.includes('AI 설명'), 3000)).includes('상품 링크를 공유하는 버튼입니다'), c);

console.log('\n== 자동완성 검색창 (E 키)');
await page.goto(`${base}/search-fixture/`);
await page.waitForTimeout(500);
await press('Control+Home', 150);
c = await press('KeyE');
check('E: 선택 상자는 건너뛰고 네이버형 검색창', c.includes('네이버 검색'), c);
c = await press('KeyE');
check('E: 유튜브형 검색창', c.includes('유튜브 검색'), c);
c = await press('Shift+KeyE');
check('Shift+E: 위쪽 검색창으로', c.includes('네이버 검색'), c);
check('C: 콤보 상자로도 찾음', (await toItem('KeyC', '유튜브 검색', 4)).includes('유튜브 검색'));
await press('Control+Home', 150);
await press('KeyE');
check('검색창에서 Enter: 글쓰기 모드', (await press('Enter', 400)).includes('글쓰기 모드'));
await press('Escape', 300);

console.log('\n== 고른 항목 알림 (선택 상자, 목록 상자, 자동완성 콤보 상자)');
await page.goto(`${base}/choice-fixture/`);
await page.waitForTimeout(500);
await page.focus('#color');
await page.waitForTimeout(300);
await page.selectOption('#color', { index: 1 });
c = await until((t) => t.includes('블랙'), 1500);
check('선택 상자에서 고르면 고른 항목과 위치를 읽음', c.startsWith('블랙, 2/3'), c);
await page.focus('#lb');
c = await until((t) => t.includes('과일'), 1500);
check('목록 상자에 가면 지금 항목도 읽음', c.includes('과일, 목록 상자, 사과'), c);
c = await press('ArrowDown', 300);
check('목록 상자 화살표: 가리키는 항목을 읽음 (초점 이동 없음)', c.startsWith('배, 선택 항목, 2/3'), c);
await page.focus('#cb');
await page.waitForTimeout(300);
c = await press('KeyA', 300);
check('콤보 상자에 글자를 칠 때 펼쳐짐을 읽지 않음', !c.includes('펼쳐짐'), c);
await press('Backspace', 200);
c = await press('ArrowDown', 300);
check('콤보 상자 화살표: 펼쳐짐과 첫 후보', c.startsWith('펼쳐짐, 서울, 선택 항목, 1/2'), c);
c = await press('ArrowDown', 300);
check('콤보 상자 다음 후보 (펼쳐짐 반복 없음)', c.startsWith('부산, 선택 항목, 2/2'), c);
c = await press('Enter', 300);
check('후보를 고르고 Enter: 들어간 값과 접힘', c.startsWith('부산, 접힘'), c);
await press('Escape', 300);

console.log('\n== 버튼 목록, 입력 요소 목록 (온글 메뉴)');
await page.goto(`${base}/action-fixture/`);
await page.waitForTimeout(500);
// 온글 메뉴에서 ㅂ(Q 키 자리)으로 버튼 목록 항목으로 간다
await press('Alt+Shift+KeyM', 400);
c = await press('KeyQ', 200);
check('메뉴에서 첫 글자(ㅂ)로 버튼 목록으로 감', c.startsWith('버튼 목록'), c);
c = await press('Enter', 400);
check('버튼 목록이 열리고 같은 이름 버튼은 앞 제목을 함께 읽음', c.includes('버튼 목록. 5개 중 1번, 장바구니 담기, 버튼, 스텐 텀블러 아래'), c);
c = await press('ArrowDown', 150);
check('두 번째 장바구니 담기는 다른 제목', c.startsWith('장바구니 담기, 버튼, 면 양말 아래'), c);
c = await press('ArrowDown', 150);
check('이름이 하나뿐인 버튼은 제목을 붙이지 않음', c.startsWith('찜하기, 버튼, 3/5'), c);
c = await press('ArrowDown', 150);
check('같은 제목 아래 같은 이름은 순서로 구분', c.startsWith('삭제, 버튼, 담은 상품 아래, 1번째'), c);
c = await press('ArrowUp', 150);
c = await press('ArrowUp', 150);
c = await press('Enter', 500);
check('고르면 그 버튼으로 이동해 읽음', c.startsWith('장바구니 담기, 버튼'), c);
c = await press('ArrowUp', 150);
check('이동한 곳은 면 양말 상품의 버튼 (바로 앞이 제목)', c.startsWith('면 양말, 제목 2'), c);
await press('Alt+Shift+KeyM', 400);
c = await press('KeyD', 200);
check('메뉴에서 ㅇ으로 입력 요소 목록으로 감', c.startsWith('입력 요소 목록'), c);
c = await press('Enter', 400);
check('입력 요소 목록: 편집창과 체크박스', c.includes('입력 요소 목록. 2개 중 1번, 쿠폰 번호'), c);
c = await press('ArrowDown', 150);
check('두 번째는 체크박스', c.includes('선물 포장') && c.includes('체크박스'), c);
await press('Escape', 200);
await press('Escape', 200);

console.log('\n== 고른 옵션 알림 (클래스로만 표시한 옵션 버튼, aria-selected)');
await page.goto(`${base}/option-fixture/`);
await page.waitForTimeout(500);
c = await toItem('KeyB', 'M', 6);
check('클래스로 고른 사이즈 버튼은 선택됨으로 읽음', c.startsWith('M, 버튼, 선택됨'), c);
c = await toItem('KeyB', 'S', 6);
check('고르지 않은 사이즈 버튼은 선택됨을 읽지 않음', c.startsWith('S, 버튼') && !c.includes('선택됨'), c);
c = await press('Enter', 400);
check('사이즈 버튼을 누르면 고른 값을 읽음', c.startsWith('S, 선택됨'), c);
c = await toItem('KeyB', 'M', 6);
check('다른 사이즈를 고르면 앞서 고른 버튼은 선택됨이 빠짐', c.startsWith('M, 버튼') && !c.includes('선택됨'), c);
c = await toItem('KeyB', '빨강', 8);
check('목록 항목에 표시가 붙은 색상 버튼도 선택됨으로 읽음', c.startsWith('빨강, 버튼, 선택됨'), c);
c = await toItem('KeyB', '파랑', 8);
c = await press('Enter', 400);
check('색상 버튼을 누르면 고른 값을 읽음', c.startsWith('파랑, 선택됨'), c);
c = await toItem('KeyC', '배송 방법', 6);
check('목록 상자는 고른 항목(aria-selected)을 값으로 읽음', c.startsWith('배송 방법, 목록 상자, 빠른 배송'), c);
c = await toItem('KeyB', '하나', 10);
check('모두 같은 클래스가 붙은 버튼은 선택으로 보지 않음', c.startsWith('하나, 버튼') && !c.includes('선택됨'), c);

console.log('\n== 가상 쇼핑몰(온글몰)');
await page.goto(`${base}/mall/`);
c = await until((t) => t.includes('온글몰'));
check('온글몰 메인을 읽음', c.includes('온글몰'), c);
check('H: 상품 목록 제목', (await toItem('KeyH', '전체 상품', 5)).includes('전체 상품, 제목 1'));
c = await toItem('KeyH', '기획전', 3);
check('H: 기획전 배너 제목', c.includes('11월 생활용품 기획전') && c.includes('제목 2'), c);
// 기획전 배너는 링크라 Tab(초점 이동)으로도 간다
await page.evaluate(() => document.getElementById('banner').focus());
c = await until((t) => t.includes('기획전') && t.includes('링크'), 1500);
check('Tab으로 기획전 배너 링크를 읽음', c.startsWith('11월 생활용품 기획전') && c.includes('링크'), c);
// 일부러 넣은 접근성 문제: 장바구니 아이콘 링크의 이름이 개수 숫자뿐. 숫자는 이름이 아니라 개수이므로
// "0, 링크" 대신 이름 없는 링크로 알리고(AI가 채움) 숫자는 함께 읽는다
await press('Control+Home', 150);
await press('KeyK', 120);
await press('KeyK', 120);
c = await press('KeyK', 120);
// 링크 단서(cart-link, cart.html)로 바로 "장바구니, 추정"이라고 읽고, 숫자는 개수로 함께 읽는다
const cartRead = /^장바구니, 추정, 0, 링크/;
check('장바구니 아이콘 링크: 숫자를 이름으로 쓰지 않고 단서로 장바구니라고 읽음, 개수도 읽음', cartRead.test(c), c);
await page.evaluate(() => document.querySelector('.cart-link').focus());
c = await until((t) => t.includes('0, 링크'), 1500);
check('Tab으로 장바구니 아이콘에 가도 같게 읽음', cartRead.test(c), c);
// 일부러 넣은 접근성 문제: 찜하기 버튼에 하트 그림만 있음 → 단서(wish)로 바로 찜하기라고 읽음
check('온글몰 찜하기 버튼: 단서로 찜하기라고 읽음', (await toItem('KeyB', '찜하기', 30)).includes('찜하기, 추정, 버튼'), await caption());
await page.goto(`${base}/mall/product.html?id=tumbler`);
c = await until((t) => t.includes('스텐 진공 텀블러'));
check('E: 상품 페이지의 첫 편집창은 검색창', (await toItem('KeyE', '상품 검색', 3)).includes('상품 검색'));
check('C: 색상 선택 상자', (await toItem('KeyC', '색상', 3)).includes('색상'));
c = await press('Enter', 400);
check('선택 상자에서 Enter: 화살표로 고르는 방법을 안내', c.includes('글쓰기 모드') && c.includes('화살표'), c);
await press('Escape', 300);
// 일부러 넣은 접근성 문제: 양말 사이즈 버튼은 고른 것을 색과 테두리(클래스 on)로만 보여 준다 → 온글이 클래스로 알아봄
await page.goto(`${base}/mall/product.html?id=socks`);
c = await until((t) => t.includes('면 양말'));
c = await toItem('KeyB', '250mm', 30);
check('온글몰 사이즈 버튼: 고르기 전에는 선택됨 없음', c.startsWith('250mm, 버튼') && !c.includes('선택됨'), c);
c = await press('Enter', 500);
check('온글몰 사이즈 버튼을 누르면 고른 값을 읽음', c.includes('250mm, 선택됨') || (await until((t) => t.includes('250mm, 선택됨'), 1500)).includes('250mm, 선택됨'), c);
c = await toItem('KeyB', '250mm', 30);
check('온글몰 사이즈 버튼: 고른 뒤 다시 가면 선택됨', c.startsWith('250mm, 버튼, 선택됨'), c);

console.log('\n== 상품 핵심 정보 (Alt+Shift+P)');
await page.goto(`${base}/mall/product.html?id=tumbler`);
c = await until((t) => t.includes('스텐 진공 텀블러'));
c = await press('Alt+Shift+KeyP', 500);
check('상품 핵심 정보 목록이 상품명부터 열림', c.startsWith('상품 핵심 정보') && c.includes('상품명, 스텐 진공 텀블러'), c);
const productEntries = [c];
for (let i = 0; i < 5; i++) productEntries.push(await press('ArrowDown', 150));
const productText = productEntries.join(' / ');
check('가격을 찾음', /가격, [^/]*원/.test(productText), productText);
check('옵션(색상 선택 상자)을 찾음', productText.includes('옵션, 색상'), productText);
check('수량을 찾음', productText.includes('수량,'), productText);
check('구매 버튼을 찾음', productText.includes('구매, 바로 구매'), productText);
check('장바구니 버튼을 찾음', productText.includes('장바구니, 장바구니 담기'), productText);
// 목록에서 구매 버튼으로 간다: Alt+Shift+P → 위쪽 화살표 두 번(끝에서 거꾸로) → Enter, 키 네 번
await press('Escape', 200);
await press('Escape', 200);
await press('Control+Home', 150);
await press('Alt+Shift+KeyP', 400);
await press('ArrowUp', 150);
c = await press('ArrowUp', 150);
check('목록 끝에서 거꾸로 두 번이면 구매 버튼', c.startsWith('구매, 바로 구매'), c);
c = await press('Enter', 500);
check('키 네 번으로 구매 버튼으로 이동', c.startsWith('바로 구매, 버튼'), c);
await page.goto(`${base}/mall/product.html?id=socks`);
c = await until((t) => t.includes('면 양말'));
c = await press('Alt+Shift+KeyP', 500);
const socks = [c];
for (let i = 0; i < 6; i++) socks.push(await press('ArrowDown', 150));
check('사이즈 버튼 묶음을 옵션으로 찾음', socks.join(' / ').includes('옵션, 사이즈, 230mm'), socks.join(' / '));
await press('Escape', 200);
await press('Escape', 200);
await page.goto(`${base}/mall/`);
c = await until((t) => t.includes('온글몰'));
c = await press('Alt+Shift+KeyP', 500);
check('상품 페이지가 아니면 찾지 못했다고 알림', c.includes('상품 정보를 찾지 못했습니다'), c);
await press('Escape', 200);
await press('Escape', 200);

console.log('\n== 같은 모양 항목, 단서 없는 항목 (가짜 AI)');
const callsBefore = labelCalls.length;
await page.goto(`${base}/shape-fixture/`);
await page.waitForTimeout(2800); // 미리 분석 (도움돼요는 한 번, 다른 모양 둘)
const likeCalls = labelCalls.slice(callsBefore).filter((t) => t.includes('btn-like')).length;
check('같은 모양 도움돼요 버튼 3개를 AI에 한 번만 물음', likeCalls === 1, `${likeCalls}번`);
await press('Control+Home', 150);
const likes = [];
for (let i = 0; i < 3; i++) likes.push(await press('KeyB', 150));
check('같은 모양 버튼 3개 모두 같은 AI 이름으로 읽음', likes.every((t) => t.startsWith('도움돼요, AI 추정, 버튼')), likes.join(' / '));
c = await toItem('KeyB', '이름 없음, 버튼', 8);
check('단서 없는 버튼: 이름 없음 + AI 분석 중', c.startsWith('이름 없음, 버튼') || (await until((t) => t.includes('AI'), 1500)).includes('AI'), c);
c = await until((t) => t.includes('분석 결과') || t.includes('이름 후보'), 4000);
check('그 자리에 있으면 결과를 읽음', c.includes('이름 후보, AI 추정, 버튼'), c);

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
