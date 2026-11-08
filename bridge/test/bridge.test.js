import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_ID,
  HOST_NAME,
  PROTOCOL,
  classifyCodexFailure,
  cmdLine,
  createDecoder,
  limitBytes,
  encodeMessage,
  execArgs,
  filterModels,
  hostManifest,
  parseFeatureNames,
  parseLoginOutput
} from '../protocol.mjs';
import { createBridge, dataDir } from '../host.mjs';
import { browserHostDirs, install, launcherScript, uninstall } from '../install.mjs';
import { HOST_NAME as EXT_HOST_NAME, PROTOCOL as EXT_PROTOCOL } from '../../extension/lib/chatgpt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const unixOnly = { skip: process.platform === 'win32' && '가짜 codex가 sh 스크립트라 Windows에서는 건너뜀' };

test('메시지 틀: 길이 + JSON을 나뉘어 와도 하나씩 꺼낸다', () => {
  const got = [];
  const decode = createDecoder((m) => got.push(m));
  const bytes = Buffer.concat([encodeMessage({ a: 1 }), encodeMessage({ b: '한글' })]);
  for (let i = 0; i < bytes.length; i += 3) decode(bytes.subarray(i, i + 3));
  assert.deepEqual(got, [{ a: 1 }, { b: '한글' }]);
  assert.throws(() => createDecoder(() => {}, { maxLength: 4 })(encodeMessage({ long: 'xxxxxxxx' })), /too long/);
});

test('확장과 연결 프로그램의 이름·규약 버전이 같고, 확장 ID가 manifest의 key에서 나온다', () => {
  assert.equal(EXT_HOST_NAME, HOST_NAME);
  assert.equal(EXT_PROTOCOL, PROTOCOL);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  const hex = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.equal(id, EXTENSION_ID);
  assert.deepEqual(hostManifest('/x/run.sh').allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
});

test('로그인 출력에서 OpenAI 로그인 주소와 기기 코드를 찾는다 (다른 주소는 버림)', () => {
  const device = [
    '\x1b[1mWelcome to Codex\x1b[0m',
    '1. Open this link in your browser and sign in to your account',
    '   https://evil.example.com/codex/device',
    '   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m',
    '2. Enter this one-time code (expires in 15 minutes)',
    '   5X07-5HD07'
  ].join('\n');
  assert.deepEqual(parseLoginOutput(device, 'device'), { url: 'https://auth.openai.com/codex/device', code: '5X07-5HD07' });
  const browser = 'Starting local login server on http://localhost:1455.\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x\n';
  assert.deepEqual(parseLoginOutput(browser, 'browser'), {
    url: 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x',
    code: null
  });
  assert.deepEqual(parseLoginOutput('https://auth.openai.com.evil.io/oauth/authorize', 'browser'), { url: null, code: null });
});

test('모델 목록: 보이는(list) 모델 중 그림을 받는 것만 순서대로', () => {
  const models = filterModels({
    models: [
      { slug: 'b', display_name: 'B 모델', visibility: 'list', input_modalities: ['text', 'image'], priority: 2 },
      { slug: 'hidden', visibility: 'hide', input_modalities: ['image'], priority: 0 },
      { slug: 'text-only', visibility: 'list', input_modalities: ['text'], priority: 1 },
      { slug: 'a', visibility: 'list', input_modalities: ['image'], priority: 1 }
    ]
  });
  assert.deepEqual(models, [
    { slug: 'a', name: 'a' },
    { slug: 'b', name: 'B 모델' }
  ]);
  assert.deepEqual(filterModels({}), []);
});

test('codex exec 인자: 기록을 남기지 않고 읽기 전용, 있는 기능만 끄고, 질문은 표준 입력', () => {
  const available = parseFeatureNames('shell_tool  stable  true\napps   stable true\n\x1b[2mnot-a-name x\x1b[0m\n');
  const args = execArgs({ workDir: '/w', outputFile: '/o.txt', images: ['/1.png'], model: 'gpt-6-luna', availableFeatures: available });
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.deepEqual(
    args.flatMap((a, i) => (a === '--disable' ? [args[i + 1]] : [])),
    ['shell_tool', 'apps']
  );
  assert.deepEqual(args.slice(-7), ['-m', 'gpt-6-luna', '-i', '/1.png', '-o', '/o.txt', '-']);
  assert.throws(() => execArgs({ workDir: '/w', outputFile: '/o', model: 'x; rm -rf /', availableFeatures: available }), /bad model/);
  // 기능 목록을 모르면 끌 기능을 정할 수 없어 실행하지 않는다
  assert.throws(() => execArgs({ workDir: '/w', outputFile: '/o' }), /feature list unknown/);
  assert.throws(() => execArgs({ workDir: '/w', outputFile: '/o', availableFeatures: new Set() }), /feature list unknown/);
  // Windows에서 npm으로 설치한 codex.cmd도 실제 인자 그대로 실행할 수 있어야 한다
  const winArgs = execArgs({ workDir: 'C:\\Users\\홍길동\\AppData\\Local\\Temp\\ongeul-1\\work', outputFile: 'C:\\T\\answer.txt', images: ['C:\\T\\01.png'], model: 'gpt-6-luna', availableFeatures: available });
  assert.doesNotThrow(() => cmdLine('C:\\Users\\홍길동\\AppData\\Roaming\\npm\\codex.cmd', winArgs));
});

test('Codex 실패 출력을 한국어 안내로 나눈다', () => {
  assert.equal(classifyCodexFailure('Error: 401 Unauthorized').kind, 'login');
  assert.equal(classifyCodexFailure("You've hit your usage limit. Upgrade to Pro").kind, 'limit');
  assert.equal(classifyCodexFailure("The 'gpt-x' model is not supported when using Codex with a ChatGPT account.").kind, 'model');
  assert.equal(classifyCodexFailure('stream disconnected before completion').kind, 'network');
  const other = classifyCodexFailure('something odd');
  assert.equal(other.kind, 'unknown');
  for (const kind of ['login', 'limit', 'model', 'network']) assert.match(classifyCodexFailure(kind === 'login' ? '401' : kind === 'limit' ? 'rate limit' : kind === 'model' ? 'model not found' : 'network').message, /[가-힣]/);
});

test('답 글은 1MB 아래 바이트로 자르되 글자 중간에서 끊지 않는다', () => {
  assert.equal(limitBytes('짧은 답'), '짧은 답');
  const long = '가'.repeat(400_000); // 1.2MB
  const cut = limitBytes(long);
  assert.ok(Buffer.byteLength(cut) <= 900 * 1024);
  assert.ok(!cut.includes('\uFFFD') && /^가+$/.test(cut));
});

test('Windows cmd 실행 줄: 모두 따옴표로 감싸고 위험한 글자는 거부', () => {
  assert.equal(cmdLine('C:\\npm\\codex.cmd', ['exec', '-o', 'C:\\Temp\\a b\\o.txt']), '""C:\\npm\\codex.cmd" "exec" "-o" "C:\\Temp\\a b\\o.txt""');
  assert.throws(() => cmdLine('codex.cmd', ['%PATH%']), /unsafe/);
  assert.throws(() => cmdLine('codex.cmd', ['a"b']), /unsafe/);
});

// --- 가짜 codex로 연결 프로그램 전체 흐름 확인
function fakeCodex(dir) {
  const file = path.join(dir, 'codex');
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const authed = () => fs.existsSync(path.join(home, 'auth.json'));
const log = (s) => fs.appendFileSync(path.join(home, 'calls.log'), JSON.stringify(args) + '\\n');
log();
if (args[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
if (args[0] === 'features') { console.log('shell_tool stable true\\napps stable true'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') process.exit(authed() ? 0 : 1);
if (args[0] === 'login') {
  console.log('Open https://auth.openai.com/codex/device');
  console.log('code: ABCD-12345');
  setTimeout(() => { fs.writeFileSync(path.join(home, 'auth.json'), '{}'); process.exit(0); }, 100);
  return;
}
if (args[0] === 'logout') { fs.rmSync(path.join(home, 'auth.json'), { force: true }); process.exit(0); }
if (args[0] === 'debug') { console.log(JSON.stringify({ models: [{ slug: 'm1', display_name: 'M1', visibility: 'list', input_modalities: ['text','image'], priority: 1 }] })); process.exit(0); }
if (args[0] === 'exec') {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    const m = args.indexOf('-m') >= 0 ? args[args.indexOf('-m') + 1] : 'auto';
    if (m === 'gone') { console.error("The 'gone' model is not supported"); process.exit(1); }
    if (input.includes('SLOW')) { setTimeout(() => {}, 60000); return; }
    const images = args.filter((a, i) => args[i - 1] === '-i');
    const sizes = images.map((f) => fs.readFileSync(f).length);
    fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ input, model: m, sizes, cwdEmpty: fs.readdirSync(process.cwd()).length === 0 }));
  });
  return;
}
process.exit(3);
`
  );
  fs.chmodSync(file, 0o755);
  return file;
}

async function call(bridge, message) {
  const replies = [];
  await bridge.handle({ id: 7, ...message }, (r) => replies.push(r));
  return replies;
}

test('연결 프로그램: 상태 → 기기 코드 로그인 → 모델 → 답 만들기 → 로그아웃', unixOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ongeul-bridge-test-'));
  try {
    const codexHome = path.join(dir, 'home');
    const bridge = createBridge({ codexPath: fakeCodex(dir), codexHome, tmpDir: dir, log: () => {} });

    assert.deepEqual(await call(bridge, { type: 'hello' }), [{ id: 7, type: 'result', bridge: '1.0.0', protocol: 1, codex: 'codex-cli 9.9.9' }]);
    assert.deepEqual((await call(bridge, { type: 'status' }))[0], { id: 7, type: 'result', codex: true, loggedIn: false });

    const notYet = await call(bridge, { type: 'generate', prompt: '안녕' });
    assert.equal(notYet[0].kind, 'login');

    const login = await call(bridge, { type: 'login', method: 'device' });
    assert.deepEqual(login[0], { id: 7, type: 'progress', method: 'device', url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' });
    assert.deepEqual(login.at(-1), { id: 7, type: 'result', loggedIn: true });

    assert.deepEqual((await call(bridge, { type: 'models' }))[0].models, [{ slug: 'm1', name: 'M1' }]);

    const png = Buffer.from('fake-png').toString('base64');
    const [answer] = await call(bridge, { type: 'generate', prompt: '그림 설명', images: [{ mimeType: 'image/png', data: png }], model: 'm1' });
    assert.equal(answer.type, 'result');
    assert.deepEqual(JSON.parse(answer.text), { input: '그림 설명', model: 'm1', sizes: [8], cwdEmpty: true });
    // 임시 폴더(그림·답 파일)는 지운다
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('ongeul-')), []);
    const execCall = fs.readFileSync(path.join(codexHome, 'calls.log'), 'utf8').trim().split('\n').map(JSON.parse).find((a) => a[0] === 'exec');
    assert.ok(execCall.includes('--ephemeral') && execCall.at(-1) === '-');

    const [gone] = await call(bridge, { type: 'generate', prompt: 'x', model: 'gone' });
    assert.deepEqual([gone.type, gone.kind], ['error', 'model']);
    assert.match(gone.message, /모델/);

    const [bad] = await call(bridge, { type: 'generate', prompt: 'x', images: [{ mimeType: 'image/gif', data: '' }] });
    assert.equal(bad.kind, 'bad-request');

    const [slow] = await call(bridge, { type: 'generate', prompt: 'SLOW', timeoutMs: 300 });
    assert.equal(slow.kind, 'timeout');

    assert.deepEqual((await call(bridge, { type: 'logout' }))[0], { id: 7, type: 'result', loggedIn: false, remains: false });
    assert.equal((await call(bridge, { type: 'nope' }))[0].kind, 'bad-request');
    // 기능 목록은 캐시해 두고 다음 연결(새 연결 프로그램)에서 다시 쓴다
    assert.ok(fs.existsSync(path.join(codexHome, 'ongeul-features.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('기능 목록을 못 받으면 도구가 켜진 채 실행하지 않고, 연결이 끊기면 임시 폴더를 지운다', unixOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ongeul-bridge-test-'));
  try {
    const codex = path.join(dir, 'codex');
    // features는 실패, exec는 오래 걸리는 가짜 codex
    fs.writeFileSync(codex, `#!/bin/sh\ncase "$1" in\n  features) exit 1;;\n  login) exit 0;;\n  exec) cat >/dev/null; sleep 30;;\nesac\n`);
    fs.chmodSync(codex, 0o755);
    const bridge = createBridge({ codexPath: codex, codexHome: path.join(dir, 'home'), tmpDir: dir, log: () => {} });
    const [refused] = await call(bridge, { type: 'generate', prompt: 'x' });
    assert.equal(refused.kind, 'codex-broken');

    fs.writeFileSync(path.join(dir, 'home', 'ongeul-features.json'), JSON.stringify({ stamp: 'other', names: [] }));
    fs.writeFileSync(codex, `#!/bin/sh\ncase "$1" in\n  features) echo "shell_tool stable true";;\n  login) exit 0;;\n  exec) cat >/dev/null; sleep 30;;\nesac\n`);
    const pending = call(bridge, { type: 'generate', prompt: 'x', images: [{ mimeType: 'image/png', data: 'AAAA' }] });
    for (let i = 0; i < 50 && !fs.readdirSync(dir).some((f) => f.startsWith('ongeul-')); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('ongeul-')), '임시 폴더가 생겨야 함');
    await new Promise((r) => setTimeout(r, 300));
    bridge.closeAll();
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('ongeul-')), []);
    const [stopped] = await pending;
    assert.equal(stopped.type, 'error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex가 없으면 설치 안내를 돌려준다', async () => {
  const bridge = createBridge({ codexPath: null, codexHome: path.join(os.tmpdir(), 'none'), log: () => {} });
  assert.equal((await call(bridge, { type: 'hello' }))[0].codex, null);
  assert.deepEqual((await call(bridge, { type: 'status' }))[0], { id: 7, type: 'result', codex: false, loggedIn: false });
  const [error] = await call(bridge, { type: 'generate', prompt: 'x' });
  assert.equal(error.kind, 'no-codex');
  assert.match(error.message, /Codex CLI를 찾지 못했습니다/);
});

test('설치·제거: 사용자 폴더에 연결 프로그램과 브라우저 등록 파일을 쓰고 지운다', unixOnly, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ongeul-install-test-'));
  try {
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const dirs = browserHostDirs(platform, home);
    fs.mkdirSync(dirs.find((d) => d.name === 'Edge').dir, { recursive: true });
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    const codex = fakeCodex(bin);
    const env = { PATH: bin, HOME: home };
    const result = install({ platform, home, env, nodePath: '/usr/bin/node' });
    assert.equal(result.codexPath, codex);
    assert.deepEqual(result.registered, ['Chrome', 'Edge']);
    const manifest = JSON.parse(fs.readFileSync(path.join(dirs[0].hosts, `${HOST_NAME}.json`), 'utf8'));
    assert.equal(manifest.path, path.join(dataDir({ platform, env, home }), 'bridge', 'run.sh'));
    assert.equal(manifest.type, 'stdio');
    assert.match(fs.readFileSync(manifest.path, 'utf8'), /exec '\/usr\/bin\/node' '.*host\.mjs'/);
    assert.ok(fs.statSync(manifest.path).mode & 0o111);
    assert.ok(fs.existsSync(path.join(path.dirname(manifest.path), 'protocol.mjs')));

    uninstall({ platform, home, env });
    assert.ok(!fs.existsSync(path.join(dirs[0].hosts, `${HOST_NAME}.json`)));
    assert.ok(!fs.existsSync(dataDir({ platform, env, home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Windows 실행 파일은 찾아 둔 node로 host.mjs를 띄운다', () => {
  // 한글 사용자 이름 경로가 깨지지 않게 UTF-8로 바꾸고 host.mjs는 %~dp0으로 가리킨다
  assert.equal(
    launcherScript('win32', 'C:\\node\\node.exe', 'C:\\Users\\홍길동\\AppData\\Local\\Ongeul\\bridge\\host.mjs'),
    '@echo off\r\nchcp 65001 >nul\r\n"C:\\node\\node.exe" "%~dp0host.mjs" %*\r\n'
  );
  assert.equal(launcherScript('linux', "/it's/node", '/h.mjs'), `#!/bin/sh\nexec '/it'\\''s/node' '/h.mjs' "$@"\n`);
});

test('통합 zip 설치: 함께 담긴 Node.js·Codex를 사용자 폴더로 옮겨 쓰고, 다시 설치하면 새것으로 바꾼다', unixOnly, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ongeul-bundle-test-'));
  try {
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const source = path.join(home, 'zip', 'bridge');
    fs.mkdirSync(path.join(source, 'runtime', 'node'), { recursive: true });
    fs.mkdirSync(path.join(source, 'runtime', 'codex', 'codex-resources'), { recursive: true });
    for (const file of ['host.mjs', 'protocol.mjs']) fs.copyFileSync(path.join(here, '..', file), path.join(source, file));
    fs.writeFileSync(path.join(source, 'runtime', 'node', 'node'), 'node-v1');
    fs.mkdirSync(path.join(source, 'runtime', 'codex', 'bin'), { recursive: true });
    fakeCodex(path.join(source, 'runtime', 'codex', 'bin'));
    fs.writeFileSync(path.join(source, 'runtime', 'codex', 'codex-resources', 'r.json'), '{}');
    // PATH에 다른 codex가 있어도 함께 담긴 것을 쓴다
    const other = path.join(home, 'other');
    fs.mkdirSync(other);
    fakeCodex(other);
    const env = { PATH: other, HOME: home };

    const result = install({ platform, home, env, nodePath: '/usr/bin/node', source });
    const runtime = path.join(result.dest, 'runtime');
    assert.equal(result.bundled, true);
    assert.equal(result.codexPath, path.join(runtime, 'codex', 'bin', 'codex'));
    assert.ok(fs.existsSync(path.join(runtime, 'codex', 'codex-resources', 'r.json')));
    assert.match(fs.readFileSync(path.join(result.dest, 'run.sh'), 'utf8'), new RegExp(`exec '${path.join(runtime, 'node', 'node').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.dest, 'config.json'), 'utf8')).codexPath, result.codexPath);

    fs.writeFileSync(path.join(source, 'runtime', 'node', 'node'), 'node-v2');
    fs.rmSync(path.join(source, 'runtime', 'codex', 'codex-resources', 'r.json'));
    install({ platform, home, env, source });
    assert.equal(fs.readFileSync(path.join(runtime, 'node', 'node'), 'utf8'), 'node-v2');
    assert.ok(!fs.existsSync(path.join(runtime, 'codex', 'codex-resources', 'r.json')), '예전 파일은 남지 않음');
    uninstall({ platform, home, env });
    assert.ok(!fs.existsSync(result.dest));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
