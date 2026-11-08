// 설치 가이드(eval/guide/index.html)에 넣을 실제 화면을 찍는다: 확장 관리 화면(개발자 모드), 온글 설정의 ChatGPT 칸(로그인 전·후).
// 실제 Chromium + 실제 연결 프로그램(bridge/host.mjs) + 가짜 Codex로 찍으므로 이 컴퓨터의 크롬·ChatGPT 계정은 건드리지 않는다.
// 화면이 바뀌면 다시 실행한다: eval 폴더에서 node guide/capture-screens.mjs  (macOS·Linux)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_ID, HOST_NAME, hostManifest } from '../../bridge/protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../../extension');
const HOST = path.resolve(here, '../../bridge/host.mjs');
const OUT = path.join(here, 'images');
fs.mkdirSync(OUT, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-capture-'));
const profile = path.join(work, 'profile');
const codexHome = path.join(work, 'codex-home');
fs.mkdirSync(profile);
fs.mkdirSync(codexHome);

// 가짜 Codex: 로그인 상태(auth.json 있음/없음)와 모델 목록만 흉내 낸다
const fakeCodex = path.join(work, 'codex');
fs.writeFileSync(
  fakeCodex,
  `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const auth = path.join(process.env.CODEX_HOME, 'auth.json');
if (args[0] === '--version') { console.log('codex-cli 0.166.0'); process.exit(0); }
if (args[0] === 'features') { console.log('shell_tool stable true'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') process.exit(fs.existsSync(auth) ? 0 : 1);
if (args[0] === 'debug') {
  console.log(JSON.stringify({ models: [{ slug: 'model-a', display_name: '예시 모델', visibility: 'list', input_modalities: ['text', 'image'], priority: 1 }] }));
  process.exit(0);
}
if (args[0] === 'exec') {
  process.stdin.resume();
  process.stdin.on('end', () => fs.writeFileSync(args[args.indexOf('-o') + 1], 'OK'));
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
  `#!/bin/sh\nONGEUL_CODEX=${q(fakeCodex)} ONGEUL_CODEX_HOME=${q(codexHome)} exec ${q(process.execPath)} ${q(HOST)} "$@" 2>/dev/null\n`
);
fs.chmodSync(launcher, 0o755);
fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`), JSON.stringify(hostManifest(launcher)));

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  locale: 'ko-KR',
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=ko']
});

async function waitUntil(page, fn, { timeout = 10000 } = {}) {
  const end = Date.now() + timeout;
  while (!(await page.evaluate(fn).catch(() => false))) {
    if (Date.now() > end) throw new Error(`시간 초과: ${fn}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
// 눌러야 할 곳을 주황 테두리로 표시한다
const mark = (page, selectors) =>
  page.evaluate((list) => {
    for (const s of list) {
      const el = document.querySelector(s);
      if (el) Object.assign(el.style, { outline: '4px solid #ff7a1a', outlineOffset: '4px', borderRadius: '4px' });
    }
  }, selectors);
// first~last 요소를 모두 담는 영역만 찍는다
async function shotBetween(page, first, last, file) {
  // 페이지 맨 위 기준 위치 (boundingBox는 스크롤한 화면 기준이라 fullPage 자르기와 맞지 않음)
  const box = await page.evaluate(
    ([a, b]) => {
      const pick = (s) => (s.startsWith('h2=') ? [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === s.slice(3)) : document.querySelector(s));
      const top = pick(a).getBoundingClientRect().top + window.scrollY;
      const bottom = pick(b).getBoundingClientRect().bottom + window.scrollY;
      return { top, bottom };
    },
    [first, last]
  );
  const y = Math.max(0, box.top - 16);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 200, y, width: 690, height: box.bottom + 16 - y }, fullPage: true });
  console.log('찍음', file);
}

try {
  await (ctx.serviceWorkers()[0] ?? ctx.waitForEvent('serviceworker'));
  for (const p of ctx.pages()) if (p.url().includes('options')) await p.close();

  // 1) 확장 관리 화면: 개발자 모드 켜기 → "압축해제된 확장 프로그램을 로드합니다" 버튼
  const ext = await ctx.newPage();
  await ext.setViewportSize({ width: 1100, height: 420 });
  await ext.goto('chrome://extensions');
  await ext.locator('#devMode').click();
  await ext.locator('#loadUnpacked').waitFor();
  await ext.evaluate(() => {
    const root = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot;
    for (const id of ['devMode', 'loadUnpacked']) {
      Object.assign(root.getElementById(id).style, { outline: '4px solid #ff7a1a', outlineOffset: '4px', borderRadius: '6px' });
    }
  });
  await ext.waitForTimeout(400);
  await ext.screenshot({ path: path.join(OUT, 'extensions-devmode.png') });
  console.log('찍음 extensions-devmode.png');

  // 2) 온글 설정: AI 기능 켜기 + ChatGPT 계정으로 연결 → 로그인 버튼 (로그인 전)
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${EXTENSION_ID}/options/options.html`);
  await options.check('#ai-enabled');
  await options.check('#use-chatgpt');
  await waitUntil(options, () => document.getElementById('chatgpt-state').textContent.includes('로그인'));
  await mark(options, ['#ai-enabled', '#use-chatgpt', '#chatgpt-login']);
  await shotBetween(options, 'h2=AI 사용', '#chatgpt-actions', 'options-login.png');

  // 3) 로그인한 뒤: 상태 문장, 모델 "자동", 저장·연결 확인
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}');
  await options.evaluate(() => document.querySelectorAll('[style*="outline"]').forEach((el) => (el.style.outline = '')));
  await options.click('#chatgpt-recheck');
  await waitUntil(options, () => !document.getElementById('chatgpt-login').checkVisibility());
  await options.click('button[type=submit]');
  await waitUntil(options, () => document.getElementById('status').textContent.length > 0);
  await options.click('#test-button');
  await waitUntil(options, () => document.getElementById('status').textContent.includes('성공'), { timeout: 20000 });
  await mark(options, ['#chatgpt-state', '#chatgpt-model', 'button[type=submit]', '#test-button', '#status']);
  await shotBetween(options, '#chatgpt-title', '#status', 'options-done.png');
} finally {
  await ctx.close();
  fs.rmSync(work, { recursive: true, force: true });
}
