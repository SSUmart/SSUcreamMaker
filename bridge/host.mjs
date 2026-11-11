#!/usr/bin/env node
// 온글 연결 프로그램 (Native Messaging host)
// 크롬이 온글 확장의 요청이 있을 때 이 프로그램을 띄우고, 표준 입출력으로 메시지를 주고받는다. 네트워크 포트는 열지 않는다.
// ChatGPT 로그인과 AI 호출은 OpenAI 공식 Codex CLI(`codex login`, `codex exec`)가 하고, 이 프로그램은 인증 정보를 읽지 않는다.
// 설치·사용: docs/CHATGPT-LOGIN.md
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_VERSION,
  IMAGE_TYPES,
  MAX_IMAGES,
  MODEL_PATTERN,
  PROTOCOL,
  classifyCodexFailure,
  cmdLine,
  codexCandidates,
  createDecoder,
  encodeMessage,
  execArgs,
  filterModels,
  limitBytes,
  parseFeatureNames,
  parseLoginOutput
} from './protocol.mjs';

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 30_000;
const GENERATE_TIMEOUT_MS = 180_000;
const MAX_GENERATE_TIMEOUT_MS = 600_000;

// 온글 전용 폴더: 여기의 codex 폴더를 CODEX_HOME으로 써서 사용자가 원래 쓰던 Codex 설정·기록과 섞이지 않게 한다
export function dataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Ongeul');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ongeul');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ongeul');
}

function isExecutable(file) {
  try {
    fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// 설치 스크립트가 찾아 둔 codex 경로(config.json)를 먼저 쓰고, 없으면 PATH와 흔한 설치 위치에서 찾는다
export function findCodex({ configFile, env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.ONGEUL_CODEX && isExecutable(env.ONGEUL_CODEX)) return env.ONGEUL_CODEX;
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.codexPath && isExecutable(config.codexPath)) return config.codexPath;
  } catch {
    // 설정 파일이 없으면 찾아본다
  }
  return codexCandidates({ platform, env, home }).find(isExecutable) ?? null;
}

// 프로세스와 그 자식(codex가 띄운 프로세스)까지 끝낸다
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      nodeSpawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // 이미 끝났다
    }
  }
}

export function createBridge({
  codexPath,
  codexHome,
  env = process.env,
  spawn = nodeSpawn,
  tmpDir = os.tmpdir(),
  log = (...args) => console.error('[ongeul-bridge]', ...args)
}) {
  const children = new Set();
  // 답을 만드는 동안 쓰는 임시 폴더(페이지 그림이 들어 있음). 연결이 끊겨 급히 끝날 때도 지운다.
  const tempRoots = new Set();
  let closing = false;
  const childEnv = { ...env, CODEX_HOME: codexHome };
  // 크롬이 띄운 프로그램은 PATH가 짧아 codex(node 스크립트)가 node를 못 찾을 수 있다: codex와 이 node가 있는 폴더를 앞에 붙인다
  const extraPath = [...new Set([codexPath && path.dirname(codexPath), path.dirname(process.execPath)].filter(Boolean))];
  const pathKey = Object.keys(childEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  childEnv[pathKey] = [...extraPath, childEnv[pathKey]].filter(Boolean).join(path.delimiter);

  function launch(args, { cwd } = {}) {
    if (!codexPath) throw Object.assign(new Error('codex not found'), { kind: 'no-codex' });
    if (closing) throw new Error('closing');
    // Codex는 CODEX_HOME 폴더가 없으면 실행을 거부한다
    fs.mkdirSync(codexHome, { recursive: true });
    const options = { env: childEnv, cwd: cwd ?? tmpDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
    let child;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(codexPath)) {
      child = spawn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine(codexPath, args)], { ...options, windowsVerbatimArguments: true });
    } else {
      child = spawn(codexPath, args, { ...options, detached: process.platform !== 'win32' });
    }
    children.add(child);
    child.once('close', () => children.delete(child));
    return child;
  }

  // codex 명령 하나를 끝까지 실행한다. 출력은 마지막 일부만 남긴다(오류 판단·디버그용).
  function run(args, { input, timeoutMs = COMMAND_TIMEOUT_MS, cwd, onOutput } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = launch(args, { cwd });
      } catch (error) {
        resolve({ code: null, stdout: '', stderr: '', error });
        return;
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const keep = (s) => (s.length > 1_000_000 ? s.slice(-1_000_000) : s);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        stdout = keep(stdout + d);
        onOutput?.(stdout + stderr);
      });
      child.stderr.on('data', (d) => {
        stderr = keep(stderr + d);
        onOutput?.(stdout + stderr);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr, error });
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }

  // 이 Codex에 있는 기능 이름. 크롬은 요청마다 연결 프로그램을 새로 띄우므로, codex 실행 파일이 같으면(경로·크기·수정 시각)
  // CODEX_HOME의 캐시 파일을 다시 쓴다. 목록을 못 받으면 null(답 만들기를 거부)이고, 실패는 캐시하지 않는다.
  async function availableFeatures() {
    const cacheFile = path.join(codexHome, 'ongeul-features.json');
    let stamp = null;
    try {
      const stat = fs.statSync(fs.realpathSync(codexPath));
      stamp = `${codexPath}|${stat.size}|${stat.mtimeMs}`;
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.stamp === stamp && cached.names.length) return new Set(cached.names);
    } catch {
      // 캐시가 없거나 낡았다
    }
    const r = await run(['features', 'list']);
    const names = r.code === 0 ? parseFeatureNames(r.stdout) : new Set();
    if (!names.size) return null;
    if (stamp) fs.promises.writeFile(cacheFile, JSON.stringify({ stamp, names: [...names] })).catch(() => {});
    return names;
  }

  const noCodex = {
    kind: 'no-codex',
    message: 'Codex CLI를 찾지 못했습니다. 운영체제별 통합 zip을 받아 설치 파일을 다시 실행하세요.'
  };

  const notLoggedIn = {
    kind: 'login',
    message: 'ChatGPT에 로그인되어 있지 않습니다. 온글 설정에서 ChatGPT 계정으로 로그인하세요.'
  };

  const handlers = {
    async hello() {
      let codex = null;
      if (codexPath) {
        const r = await run(['--version']);
        if (r.code === 0) codex = r.stdout.trim().split('\n').pop() || 'codex';
      }
      return { bridge: BRIDGE_VERSION, protocol: PROTOCOL, codex };
    },

    async status() {
      if (!codexPath) return { codex: false, loggedIn: false };
      const r = await run(['login', 'status']);
      // 실행이 안 되거나 시간이 지난 것은 "로그인 안 됨"과 다르다
      if (r.error || r.timedOut) throw { kind: 'codex-broken', message: 'Codex CLI를 실행하지 못했습니다. 운영체제별 통합 zip을 받아 설치 파일을 다시 실행하세요.' };
      return { codex: true, loggedIn: r.code === 0 };
    },

    // 로그인: 진행 중에 로그인 주소(와 기기 코드)를 progress로 보내고, 끝나면 결과를 보낸다
    async login(message, send) {
      if (!codexPath) throw noCodex;
      const method = message.method === 'device' ? 'device' : 'browser';
      let last = '';
      const r = await run(method === 'device' ? ['login', '--device-auth'] : ['login'], {
        timeoutMs: LOGIN_TIMEOUT_MS,
        onOutput(output) {
          const info = parseLoginOutput(output, method);
          const key = JSON.stringify(info);
          // 기기 코드 방식은 주소와 코드가 둘 다 나온 뒤에 한 번에 보낸다 (안내를 두 번 읽지 않게)
          if (info.url && (method !== 'device' || info.code) && key !== last) {
            last = key;
            send({ type: 'progress', method, ...info });
          }
        }
      });
      if (r.code === 0) return { loggedIn: true };
      if (r.timedOut) throw { kind: 'timeout', message: '로그인 시간(15분)이 지났습니다. 다시 시도하세요.' };
      log('login failed', r.code, (r.stdout + r.stderr).slice(-2000));
      throw { kind: 'login-failed', message: '로그인을 끝내지 못했습니다. 다시 시도하세요.' };
    },

    async logout() {
      if (!codexPath) throw noCodex;
      await run(['logout']);
      const remains = fs.existsSync(path.join(codexHome, 'auth.json'));
      return { loggedIn: false, remains };
    },

    async models() {
      if (!codexPath) throw noCodex;
      const r = await run(['debug', 'models']);
      if (r.code !== 0) {
        log('models failed', r.code, r.stderr.slice(-2000));
        throw { kind: 'models', message: '모델 목록을 받지 못했습니다. 잠시 뒤 다시 시도하세요.' };
      }
      try {
        return { models: filterModels(JSON.parse(r.stdout)) };
      } catch {
        log('models output is not JSON', r.stdout.slice(0, 500));
        throw { kind: 'models', message: '모델 목록을 읽지 못했습니다. 연결 프로그램과 Codex CLI 버전을 확인하세요.' };
      }
    },

    // 글(과 그림)을 보내 답 글을 받는다
    async generate(message) {
      if (!codexPath) throw noCodex;
      const prompt = typeof message.prompt === 'string' ? message.prompt : '';
      if (!prompt.trim()) throw { kind: 'bad-request', message: 'AI에 보낼 글이 비어 있습니다.' };
      const images = Array.isArray(message.images) ? message.images : [];
      if (images.length > MAX_IMAGES) throw { kind: 'bad-request', message: `그림은 한 번에 ${MAX_IMAGES}장까지 보낼 수 있습니다.` };
      const model = typeof message.model === 'string' ? message.model.trim() : '';
      if (model && !MODEL_PATTERN.test(model)) throw { kind: 'model', message: '모델 이름이 올바르지 않습니다. 온글 설정에서 모델을 다시 고르세요.' };
      const timeoutMs = Math.min(Number(message.timeoutMs) || GENERATE_TIMEOUT_MS, MAX_GENERATE_TIMEOUT_MS);
      // 로그인하지 않았으면 Codex가 한참 다시 시도하다 실패하므로 먼저 확인한다 (0.1초 안팎)
      if ((await run(['login', 'status'])).code !== 0) throw notLoggedIn;

      const features = await availableFeatures();
      if (!features) {
        log('features list failed');
        throw { kind: 'codex-broken', message: 'Codex CLI의 기능 목록을 확인하지 못해 실행하지 않았습니다. 통합 zip의 설치 파일을 다시 실행한 뒤 다시 시도하세요.' };
      }
      const root = await fsp.mkdtemp(path.join(tmpDir, 'ongeul-'));
      tempRoots.add(root);
      try {
        const workDir = path.join(root, 'work');
        const imageDir = path.join(root, 'images');
        await fsp.mkdir(workDir);
        await fsp.mkdir(imageDir);
        const files = [];
        for (const [i, image] of images.entries()) {
          const ext = IMAGE_TYPES[image?.mimeType];
          if (!ext || typeof image.data !== 'string') throw { kind: 'bad-request', message: '그림 형식을 읽지 못했습니다.' };
          const file = path.join(imageDir, `${String(i + 1).padStart(2, '0')}.${ext}`);
          await fsp.writeFile(file, Buffer.from(image.data, 'base64'));
          files.push(file);
        }
        const outputFile = path.join(root, 'answer.txt');
        const args = execArgs({ workDir, outputFile, images: files, model, availableFeatures: features });
        const r = await run(args, { input: prompt, timeoutMs, cwd: workDir });
        const text = await fsp.readFile(outputFile, 'utf8').catch(() => '');
        if (r.code === 0 && text.trim()) return { text: limitBytes(text.trim()) };
        if (closing) throw { kind: 'cancelled', message: '연결이 끊겨 멈췄습니다.' };
        if (r.timedOut) throw { kind: 'timeout', message: `ChatGPT가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다. 잠시 뒤 다시 시도하세요.` };
        const output = r.stdout.slice(-20_000) + r.stderr.slice(-20_000);
        log('exec failed', r.code, output.slice(-3000));
        // 로그인이 안 된(풀린) 경우는 출력 문구가 버전마다 달라 로그인 상태를 직접 확인한다
        if ((await run(['login', 'status'])).code !== 0) throw notLoggedIn;
        throw classifyCodexFailure(output);
      } finally {
        tempRoots.delete(root);
        await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
      }
    }
  };

  // 요청 하나를 처리해 응답(들)을 보낸다. 오류 안내는 한국어 문장만 내보내고 원문은 표준 오류(로그)에만 남긴다.
  async function handle(message, write) {
    const id = message?.id ?? null;
    const send = (reply) => write({ id, ...reply });
    const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
    if (!handler) {
      send({ type: 'error', kind: 'bad-request', message: '연결 프로그램이 모르는 요청입니다. 연결 프로그램을 업데이트하세요.' });
      return;
    }
    try {
      send({ type: 'result', ...(await handler(message, send)) });
    } catch (error) {
      if (error?.kind && typeof error.message === 'string' && /[가-힣]/.test(error.message)) {
        send({ type: 'error', kind: error.kind, message: error.message });
      } else if (error?.kind === 'no-codex') {
        send({ type: 'error', ...noCodex });
      } else {
        log('unexpected', error);
        send({ type: 'error', kind: 'unknown', message: '연결 프로그램에서 알 수 없는 오류가 났습니다. 잠시 뒤 다시 시도하세요.' });
      }
    }
  }

  // 연결이 끊기면: 새 프로세스를 띄우지 않고, 돌던 codex를 끝내고, 임시 폴더(페이지 그림)를 바로 지운다
  function closeAll() {
    closing = true;
    for (const child of children) killTree(child);
    for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
    tempRoots.clear();
  }

  return { handle, closeAll, handlers };
}

// 크롬이 띄웠을 때: 표준 입력으로 메시지를 받고 표준 출력으로 답한다. 크롬이 연결을 끊으면(표준 입력이 닫히면) 하던 일을 멈추고 끝낸다.
function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const base = dataDir();
  const codexPath = findCodex({ configFile: path.join(here, 'config.json') });
  const codexHome = process.env.ONGEUL_CODEX_HOME || path.join(base, 'codex');
  const bridge = createBridge({ codexPath, codexHome });
  const write = (message) => process.stdout.write(encodeMessage(message));
  const decode = createDecoder((message) => void bridge.handle(message, write));
  process.stdin.on('data', (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      console.error('[ongeul-bridge] bad input', error);
      process.exit(1);
    }
  });
  const quit = () => {
    bridge.closeAll();
    setTimeout(() => process.exit(0), 200);
  };
  process.stdin.on('end', quit);
  process.on('SIGTERM', quit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
