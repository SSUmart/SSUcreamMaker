#!/usr/bin/env node
// 온글 연결 프로그램 설치·제거 (Windows, macOS, Linux 공통)
//   설치: node install.mjs          제거: node install.mjs --uninstall
// 관리자 권한 없이 사용자 폴더와 (Windows는) HKCU 레지스트리만 쓴다.
// 안내: docs/CHATGPT-LOGIN.md
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, findCodex } from './host.mjs';
import { BRIDGE_VERSION, HOST_NAME, cmdLine, hostManifest } from './protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const say = (text) => console.log(text);

// 연결 프로그램 등록 파일을 둘 브라우저 폴더 (macOS·Linux). 브라우저 폴더가 있는 것만 쓰고, 크롬은 없어도 만든다.
export function browserHostDirs(platform, home) {
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [
      { name: 'Chrome', dir: path.join(base, 'Google', 'Chrome'), always: true },
      { name: 'Chromium', dir: path.join(base, 'Chromium') },
      { name: 'Edge', dir: path.join(base, 'Microsoft Edge') },
      { name: 'Whale', dir: path.join(base, 'Naver', 'Whale') },
      { name: 'Brave', dir: path.join(base, 'BraveSoftware', 'Brave-Browser') }
    ].map((b) => ({ ...b, hosts: path.join(b.dir, 'NativeMessagingHosts') }));
  }
  const base = path.join(home, '.config');
  return [
    { name: 'Chrome', dir: path.join(base, 'google-chrome'), always: true },
    { name: 'Chromium', dir: path.join(base, 'chromium') },
    { name: 'Edge', dir: path.join(base, 'microsoft-edge') },
    { name: 'Whale', dir: path.join(base, 'naver-whale') },
    { name: 'Brave', dir: path.join(base, 'BraveSoftware', 'Brave-Browser') }
  ].map((b) => ({ ...b, hosts: path.join(b.dir, 'NativeMessagingHosts') }));
}

// Windows: 브라우저가 연결 프로그램 등록 파일을 찾는 레지스트리 키 (HKCU)
export const WINDOWS_REGISTRY_KEYS = [
  { name: 'Chrome', key: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}` },
  { name: 'Edge', key: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}` }
];

// 크롬이 실행할 파일. 크롬이 띄운 프로그램은 PATH가 짧을 수 있어 설치할 때 찾은 node 경로를 그대로 적는다.
// Windows: cmd.exe는 배치 파일을 콘솔 코드 페이지(한국어 Windows는 949)로 읽어 한글 경로(사용자 이름)가 깨지므로
// 먼저 UTF-8(65001)로 바꾸고, host.mjs는 %~dp0(이 파일의 폴더, 유니코드로 풀림)으로 가리킨다.
// 이 파일의 출력은 크롬과 주고받는 통로로 들어가므로 chcp 출력도 버린다(>nul).
export function launcherScript(platform, nodePath, hostPath) {
  if (platform === 'win32') return `@echo off\r\nchcp 65001 >nul\r\n"${nodePath}" "%~dp0${path.win32.basename(hostPath)}" %*\r\n`;
  const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh\nexec ${q(nodePath)} ${q(hostPath)} "$@"\n`;
}

// 통합 zip(scripts/package-bundle.sh)에는 연결 프로그램 옆 runtime 폴더에 Node.js와 Codex CLI가 들어 있다
export function bundledRuntime(dir, platform = process.platform) {
  const exe = platform === 'win32' ? '.exe' : '';
  const node = path.join(dir, 'runtime', 'node', `node${exe}`);
  const codex = path.join(dir, 'runtime', 'codex', 'bin', `codex${exe}`);
  return fs.existsSync(node) && fs.existsSync(codex) ? { dir: path.join(dir, 'runtime'), node, codex } : null;
}

function reg(args) {
  return spawnSync('reg', args, { stdio: 'ignore', windowsHide: true }).status === 0;
}

export function install({ platform = process.platform, home = os.homedir(), env = process.env, nodePath = process.execPath, source = here } = {}) {
  const base = dataDir({ platform, env, home });
  const dest = path.join(base, 'bridge');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ['host.mjs', 'protocol.mjs']) fs.copyFileSync(path.join(source, file), path.join(dest, file));
  let codexPath;
  const bundled = bundledRuntime(source, platform);
  if (bundled) {
    // 함께 담긴 Node.js·Codex를 사용자 폴더로 옮겨 쓴다 (압축을 푼 폴더를 옮기거나 지워도 동작하게). 예전 것은 지우고 새로 넣는다.
    const runtime = path.join(dest, 'runtime');
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.cpSync(bundled.dir, runtime, { recursive: true });
    // macOS: 인터넷에서 받은 파일 표시(격리)를 지워 실행할 때 막히지 않게 한다
    if (platform === 'darwin') spawnSync('xattr', ['-dr', 'com.apple.quarantine', runtime], { stdio: 'ignore' });
    nodePath = path.join(runtime, path.relative(bundled.dir, bundled.node));
    codexPath = path.join(runtime, path.relative(bundled.dir, bundled.codex));
  } else {
    codexPath = findCodex({ configFile: path.join(dest, '__none__'), env, platform, home });
  }
  fs.writeFileSync(path.join(dest, 'config.json'), JSON.stringify({ version: BRIDGE_VERSION, nodePath, codexPath }, null, 2) + '\n');

  const launcher = path.join(dest, platform === 'win32' ? 'run.cmd' : 'run.sh');
  fs.writeFileSync(launcher, launcherScript(platform, nodePath, path.join(dest, 'host.mjs')));
  if (platform !== 'win32') fs.chmodSync(launcher, 0o755);
  const manifest = JSON.stringify(hostManifest(launcher), null, 2) + '\n';

  const registered = [];
  if (platform === 'win32') {
    const manifestPath = path.join(dest, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, manifest);
    for (const { name, key } of WINDOWS_REGISTRY_KEYS) {
      if (reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'])) registered.push(name);
    }
  } else {
    for (const browser of browserHostDirs(platform, home)) {
      if (!browser.always && !fs.existsSync(browser.dir)) continue;
      fs.mkdirSync(browser.hosts, { recursive: true });
      fs.writeFileSync(path.join(browser.hosts, `${HOST_NAME}.json`), manifest);
      registered.push(browser.name);
    }
  }
  return { dest, codexPath, registered, bundled: Boolean(bundled) };
}

// 통합 zip의 extension 폴더 경로를 클립보드에 넣는다 (브라우저의 폴더 고르기 창에 붙여넣기 하도록). 실패해도 설치에는 영향 없음.
function copyToClipboard(text) {
  if (process.env.ONGEUL_NO_CLIPBOARD) return false;
  try {
    if (process.platform === 'win32') {
      return spawnSync('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $env:ONGEUL_COPY'], {
        env: { ...process.env, ONGEUL_COPY: text },
        stdio: 'ignore',
        windowsHide: true,
        timeout: 15_000
      }).status === 0;
    }
    if (process.platform === 'darwin') {
      return spawnSync('pbcopy', [], { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' }, timeout: 15_000 }).status === 0;
    }
  } catch {
    // 클립보드를 못 써도 경로는 화면에 보인다
  }
  return false;
}

export function uninstall({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const base = dataDir({ platform, env, home });
  // ChatGPT 로그인 정보도 지운다 (Codex로 로그아웃한 뒤 온글 전용 폴더째 삭제)
  const codexPath = findCodex({ configFile: path.join(base, 'bridge', 'config.json'), env, platform, home });
  const codexHome = path.join(base, 'codex');
  if (codexPath && fs.existsSync(codexHome)) {
    const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(codexPath);
    spawnSync(shell ? env.ComSpec || 'cmd.exe' : codexPath, shell ? ['/d', '/s', '/c', cmdLine(codexPath, ['logout'])] : ['logout'], {
      env: { ...env, CODEX_HOME: codexHome },
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: shell,
      timeout: 30_000
    });
  }
  if (platform === 'win32') {
    for (const { key } of WINDOWS_REGISTRY_KEYS) reg(['delete', key, '/f']);
  } else {
    for (const browser of browserHostDirs(platform, home)) fs.rmSync(path.join(browser.hosts, `${HOST_NAME}.json`), { force: true });
  }
  fs.rmSync(base, { recursive: true, force: true });
  return { removed: base };
}

function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    say(`Node.js ${process.versions.node}은 너무 오래되었습니다. Node.js 20 이상을 설치한 뒤 다시 실행하세요.`);
    process.exit(1);
  }
  if (process.argv.includes('--uninstall')) {
    const { removed } = uninstall();
    say('온글 연결 프로그램을 제거했습니다. ChatGPT 로그인 정보도 지웠습니다.');
    say(`지운 폴더: ${removed}`);
    return;
  }
  let result;
  try {
    result = install();
  } catch (error) {
    console.error(error);
    say('설치하지 못했습니다. 브라우저를 모두 닫고(온글이 연결 프로그램을 쓰고 있을 수 있음) 다시 실행하세요.');
    process.exit(1);
  }
  const { dest, codexPath, registered, bundled } = result;
  say(`온글 연결 프로그램 ${BRIDGE_VERSION}을 설치했습니다.`);
  say(`설치 폴더: ${dest}`);
  say(`등록한 브라우저: ${registered.length ? registered.join(', ') : '없음'}`);
  if (!registered.length) {
    say('브라우저에 등록하지 못했습니다. 이 창의 내용을 개발팀에 알려 주세요.');
    process.exitCode = 1;
  }
  if (codexPath) {
    say(`Codex CLI: ${codexPath}${bundled ? ' (함께 담긴 것)' : ''}`);
    const extension = path.resolve(here, '..', 'extension');
    if (bundled && fs.existsSync(path.join(extension, 'manifest.json'))) {
      say('');
      say('다음 순서:');
      say('1. 브라우저를 완전히 껐다 켭니다.');
      say('2. chrome://extensions 에서 개발자 모드를 켜고 "압축해제된 확장 프로그램을 로드합니다"로 아래 폴더를 고릅니다. 이미 설치돼 있으면 새로고침만 누릅니다.');
      say(`   ${extension}`);
      if (copyToClipboard(extension)) say('   (이 경로를 클립보드에 복사해 두었습니다. 폴더 고르는 창의 주소 칸에 붙여넣기 하세요.)');
      say('3. 온글 설정에서 AI 기능 켜기와 "ChatGPT 계정으로 연결"을 켜고 "ChatGPT 로그인 (브라우저)"를 누릅니다.');
    } else {
      say('이제 브라우저를 완전히 껐다 켠 뒤, 온글 설정에서 "ChatGPT 계정으로 연결"을 켜고 ChatGPT 로그인을 누르세요.');
    }
  } else {
    say('Codex CLI를 찾지 못했습니다. 운영체제별 통합 zip(Node.js·Codex CLI 포함)을 받아 그 안의 설치 파일을 실행하세요.');
    say('  (이미 Node.js가 있다면 npm install -g @openai/codex 로 설치한 뒤 이 설치를 다시 실행해도 됩니다.)');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
