// ChatGPT 계정 연결 E2E 점검: 실제 Chromium + 실제 연결 프로그램(bridge/host.mjs) + 가짜 Codex CLI로
// 설정 화면의 연결 방식 고르기, 연결 프로그램 미설치 안내, 기기 코드 로그인, 모델 목록, 연결 확인, 페이지 요약, 로그아웃을 확인한다.
// 연결 프로그램은 임시 브라우저 프로필 폴더(NativeMessagingHosts)에만 등록하므로 이 컴퓨터의 크롬·ChatGPT 계정은 건드리지 않는다.
// 사용법: eval 폴더에서 npm run e2e:chatgpt  (macOS·Linux)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from './shop/serve.mjs';
import { EXTENSION_ID, HOST_NAME, hostManifest } from '../bridge/protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const HOST = path.resolve(here, '../bridge/host.mjs');
const OUT = path.join(here, 'results', 'e2e-chatgpt');
fs.mkdirSync(OUT, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-chatgpt-'));
const profile = path.join(work, 'profile');
const codexHome = path.join(work, 'codex-home');
fs.mkdirSync(profile);

// 가짜 Codex: 기기 코드 로그인, 모델 목록, 요약 답을 흉내 낸다. 받은 exec 인자와 질문은 calls.jsonl에 남긴다.
const fakeCodex = path.join(work, 'codex');
fs.writeFileSync(
  fakeCodex,
  `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const auth = path.join(home, 'auth.json');
if (args[0] === '--version') { console.log('codex-cli 0.0.0-fake'); process.exit(0); }
if (args[0] === 'features') { console.log('shell_tool stable true'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') process.exit(fs.existsSync(auth) ? 0 : 1);
if (args[0] === 'login') {
  console.log('1. Open this link\\n   https://auth.openai.com/codex/device\\n2. Enter this one-time code\\n   AB12-CD345');
  setTimeout(() => { fs.writeFileSync(auth, '{}'); process.exit(0); }, 1500);
  return;
}
if (args[0] === 'logout') { fs.rmSync(auth, { force: true }); process.exit(0); }
if (args[0] === 'debug') {
  console.log(JSON.stringify({ models: [
    { slug: 'fake-big', display_name: 'Fake Big', visibility: 'list', input_modalities: ['text', 'image'], priority: 1 },
    { slug: 'fake-text', display_name: 'Text Only', visibility: 'list', input_modalities: ['text'], priority: 2 },
    { slug: 'fake-small', display_name: 'Fake Small', visibility: 'list', input_modalities: ['text', 'image'], priority: 3 }
  ] }));
  process.exit(0);
}
if (args[0] === 'exec') {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify({ args, input }) + '\\n');
    let answer = 'OK';
    if (input.startsWith('다음 웹페이지 글을 요약하세요')) {
      const line = input.split('\\n').find((l) => /^\\[\\d+\\]/.test(l) && l.includes('24,900'));
      const n = line ? Number(line.match(/^\\[(\\d+)\\]/)[1]) : 1;
      answer = '\`\`\`json\\n' + JSON.stringify({ overview: 'ChatGPT로 만든 텀블러 요약입니다.', items: [{ text: '판매가 24,900원', sources: [n] }] }) + '\\n\`\`\`';
    }
    fs.writeFileSync(args[args.indexOf('-o') + 1], answer);
  });
  return;
}
process.exit(3);
`
);
fs.chmodSync(fakeCodex, 0o755);

const launcher = path.join(work, 'run.sh');
const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
fs.writeFileSync(
  launcher,
  `#!/bin/sh\nONGEUL_CODEX=${q(fakeCodex)} ONGEUL_CODEX_HOME=${q(codexHome)} exec ${q(process.execPath)} ${q(HOST)} "$@" 2>>${q(path.join(work, 'host.log'))}\n`
);
fs.chmodSync(launcher, 0o755);
const hostsDir = path.join(profile, 'NativeMessagingHosts');
const register = () => {
  fs.mkdirSync(hostsDir, { recursive: true });
  fs.writeFileSync(path.join(hostsDir, `${HOST_NAME}.json`), JSON.stringify(hostManifest(launcher), null, 2));
};

const server = http.createServer((req, res) => {
  if (serveShop(req, res)) return;
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  locale: 'ko-KR',
  viewport: { width: 1280, height: 1000 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) process.exitCode = 1;
};
const calls = () =>
  fs.existsSync(path.join(codexHome, 'calls.jsonl'))
    ? fs.readFileSync(path.join(codexHome, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    : [];

// 확장 페이지는 CSP 때문에 page.waitForFunction(내부에서 문자열 평가)을 쓸 수 없어 직접 되풀이해 확인한다
async function waitUntil(page, fn, arg, { timeout = 10000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    if (Date.now() > end) throw new Error(`시간 초과: ${fn.toString().slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  check('확장 ID가 고정 ID(manifest key)와 같음', new URL(sw.url()).host === EXTENSION_ID, sw.url());

  for (const p of ctx.pages()) if (p.url().includes('options')) await p.close();
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${EXTENSION_ID}/options/options.html`);
  const status = () => options.textContent('#status');
  const state = () => options.textContent('#chatgpt-state');

  // 1) 기본은 API 키 연결, ChatGPT 칸은 숨김
  check('기본은 ChatGPT 연결 꺼짐(API 키)', !(await options.isChecked('#use-chatgpt')));
  check('API 연결이면 ChatGPT 칸 숨김, API 칸 보임', !(await options.isVisible('#chatgpt-settings')) && (await options.isVisible('#gemini-key')));

  // 2) 연결 프로그램이 없을 때
  await options.check('#use-chatgpt');
  check('ChatGPT를 켜면 API 키 칸 숨김', !(await options.isVisible('#gemini-key')) && (await options.isVisible('#chatgpt-settings')));
  await waitUntil(options, () => !document.getElementById('chatgpt-state').textContent.includes('확인하는 중'));
  check('미설치: 안내 문장', (await state()).includes('설치되어 있지 않습니다'), await state());
  check('미설치: 설치 안내 링크 보임', await options.isVisible('#chatgpt-guide'));
  check('미설치: 로그인 버튼 숨김', !(await options.isVisible('#chatgpt-login')));
  const steps = () => options.$$eval('#test-steps li', (li) => li.map((x) => x.textContent));
  await options.click('#test-button');
  await waitUntil(options, () => /성공|실패/.test(document.getElementById('status').textContent));
  check('미설치 연결 확인: 1단계에서 막혔다고 알림', (await status()).startsWith('연결 실패. ChatGPT 연결 1단계(연결 프로그램)에서 막혔습니다. 온글 연결 프로그램이 설치되어 있지 않습니다'), await status());
  check('미설치 연결 확인: 단계별 결과', JSON.stringify((await steps()).map((t) => t.split(',')[0])) === JSON.stringify(['1단계 연결 프로그램: 막힘', '2단계 Codex CLI: 확인하지 않음', '3단계 로그인: 확인하지 않음', '4단계 모델 요청: 확인하지 않음']), JSON.stringify(await steps()));

  // 3) 연결 프로그램 등록 → 다시 확인 → 로그인 안 됨
  register();
  await options.click('#chatgpt-recheck');
  await waitUntil(options, () => document.getElementById('status').textContent.includes('로그인되어 있지 않습니다'));
  check('설치됨: 로그인 안 됨 안내', (await state()).includes('로그인되어 있지 않습니다'));
  check('설치됨: 설치 안내 숨김', !(await options.isVisible('#chatgpt-install')));
  check('설치됨: 로그인 버튼 두 개 보임', (await options.isVisible('#chatgpt-login')) && (await options.isVisible('#chatgpt-device')));

  // 4) 기기 코드 로그인
  await options.click('#chatgpt-device');
  await waitUntil(options, () => document.getElementById('status').textContent.includes('일회용 코드는'));
  check('기기 코드: 한 글자씩 읽는 안내', (await status()).includes('A, B, 1, 2, 붙임표, C, D, 3, 4, 5'), await status());
  check('기기 코드: 코드 표시', (await options.textContent('#chatgpt-code')).includes('AB12-CD345'));
  check('기기 코드: 로그인 페이지 링크', (await options.getAttribute('#chatgpt-login-link', 'href')) === 'https://auth.openai.com/codex/device');
  check('기기 코드: 진행 중에는 취소 버튼만', (await options.isVisible('#chatgpt-cancel')) && !(await options.isVisible('#chatgpt-device')));
  await options.screenshot({ path: path.join(OUT, 'device-code.png'), fullPage: true });
  await waitUntil(options, () => document.getElementById('chatgpt-state').textContent.includes('로그인되어 있습니다'), null, { timeout: 15000 });
  check('로그인 완료 안내', (await status()).includes('ChatGPT에 로그인했습니다'), await status());
  check('로그인 뒤 로그아웃 버튼', await options.isVisible('#chatgpt-logout'));

  // 5) 모델 목록: 그림을 받는 모델만, 자동이 맨 앞
  await waitUntil(options, () => document.querySelectorAll('#chatgpt-model option').length > 1);
  const models = await options.$$eval('#chatgpt-model option', (o) => o.map((x) => x.textContent));
  check('모델 목록: 자동 + 그림 모델 둘', JSON.stringify(models) === JSON.stringify(['자동 (계정 기본 모델)', 'Fake Big', 'Fake Small']), JSON.stringify(models));

  // 6) 저장 → 연결 확인
  await options.selectOption('#chatgpt-model', 'fake-small');
  await options.check('#ai-enabled');
  await options.click('button[type=submit]');
  await waitUntil(options, () => document.getElementById('status').textContent.startsWith('저장했습니다'));
  check('저장: ChatGPT로 연결 안내', (await status()).includes('ChatGPT 계정으로 연결합니다'), await status());
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  check('저장: 연결 방식·모델', saved.connection === 'chatgpt' && saved.chatgpt.model === 'fake-small' && !('labelWithApi' in saved.chatgpt));
  await options.click('#test-button');
  await waitUntil(options, () => /성공|실패/.test(document.getElementById('status').textContent));
  check('연결 확인 성공: 네 단계 모두 됨', (await status()) === 'ChatGPT 연결에 성공했습니다. 연결 프로그램, Codex CLI, 로그인, 모델 요청 네 단계가 모두 됩니다.', await status());
  check('연결 확인 성공: 단계별 결과 네 줄 모두 됨', (await steps()).length === 4 && (await steps()).every((t) => t.includes(': 됨')), JSON.stringify(await steps()));
  const testCall = calls().at(-1);
  check('연결 확인: 고른 모델로 codex exec', testCall?.args.includes('-m') && testCall.args[testCall.args.indexOf('-m') + 1] === 'fake-small');
  check('연결 확인: 기록 안 남김·읽기 전용', testCall?.args.includes('--ephemeral') && testCall.args[testCall.args.indexOf('--sandbox') + 1] === 'read-only');

  // 7) 페이지 요약을 ChatGPT로
  const page = await ctx.newPage();
  await page.goto(`${base}/shop/`);
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-text.js', 'content/summary.js'] });
  });
  await page.waitForSelector('#ssucream-summary-title', { timeout: 30000 });
  await page.waitForFunction(() => !/중$/.test(document.getElementById('ssucream-summary-title').textContent), null, { timeout: 30000 });
  const summary = await page.textContent('#ssucream-summary');
  check('요약: ChatGPT 답으로 상자 표시', summary.includes('ChatGPT로 만든 텀블러 요약입니다') && summary.includes('판매가 24,900원'), summary.slice(0, 120));
  check('요약: 페이지 글이 질문으로 감', calls().at(-1)?.input.includes('24,900원'));
  await page.screenshot({ path: path.join(OUT, 'summary.png') });

  // 8) 로그아웃 → 요약은 로그인 안내
  await options.bringToFront();
  await options.click('#chatgpt-logout');
  await waitUntil(options, () => document.getElementById('status').textContent.includes('로그아웃했습니다'));
  await waitUntil(options, () => document.getElementById('chatgpt-state').textContent.includes('로그인되어 있지 않습니다'));
  check('로그아웃: 상태 바뀜, 로그인 버튼 다시 보임', await options.isVisible('#chatgpt-login'));
  const answer = await options.evaluate(async () => {
    const { PROVIDERS } = await import('../lib/providers.js');
    try {
      await PROVIDERS.chatgpt.generateJson('다른 질문', { model: '' });
      return 'no error';
    } catch (e) {
      return e.message;
    }
  });
  check('로그아웃 뒤 AI 요청: 막힌 단계(로그인)와 해결 방법', answer.startsWith('ChatGPT 연결 3단계(로그인)에서 막혔습니다.') && answer.includes('로그인'), answer);
  await options.click('#test-button');
  await waitUntil(options, () => /성공|실패/.test(document.getElementById('status').textContent));
  check('로그아웃 뒤 연결 확인: 3단계에서 막힘', (await status()).startsWith('연결 실패. ChatGPT 연결 3단계(로그인)에서 막혔습니다.'), await status());
  check('로그아웃 뒤 연결 확인: 1·2단계는 됨', (await steps())[0].includes(': 됨') && (await steps())[1].includes(': 됨') && (await steps())[2].includes(': 막힘'), JSON.stringify(await steps()));
  await options.screenshot({ path: path.join(OUT, 'connection-check.png'), fullPage: true });
} finally {
  await ctx.close();
  server.close();
  if (process.exitCode) console.log(`연결 프로그램 로그: ${path.join(work, 'host.log')}`);
  else fs.rmSync(work, { recursive: true, force: true });
}
