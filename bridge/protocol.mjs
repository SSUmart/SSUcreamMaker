// 온글 연결 프로그램의 순수 함수 모음 (프로세스·파일을 건드리지 않아 테스트하기 쉬운 부분)
// 설치·사용: docs/CHATGPT-LOGIN.md

export const BRIDGE_VERSION = '1.0.0';
// 확장과 연결 프로그램이 주고받는 메시지 모양의 버전. 바뀌면 확장이 "연결 프로그램을 업데이트하세요"라고 안내한다.
export const PROTOCOL = 1;
export const HOST_NAME = 'me.jaymong.ongeul';
// 온글 확장 ID. extension/manifest.json의 key(공개 키)로 정해지며, 연결 프로그램 등록 파일의 allowed_origins에 이 ID만 넣는다.
// key를 바꾸면 ID가 바뀌므로 바꾸지 않는다 (bridge/test에서 key와 이 값이 맞는지 확인).
export const EXTENSION_ID = 'oaiehepelkgdbabadijehnmgogahkpab';

// 크롬에 등록하는 연결 프로그램 정보 (설치 스크립트가 path를 채워 파일로 쓴다)
export function hostManifest(launcherPath) {
  return {
    name: HOST_NAME,
    description: '온글 연결 프로그램 (ChatGPT 로그인)',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };
}

// --- Native Messaging 틀: 4바이트 길이(이 기기의 바이트 순서, 크롬이 쓰는 기기는 모두 little-endian) + UTF-8 JSON
export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// 받은 바이트를 쌓아 두었다가 다 온 메시지만 꺼낸다.
// 큰 요청(그림 여러 장, 수 MB)이 작은 조각으로 와도 조각을 모아 두었다가 한 메시지가 다 왔을 때만 합친다.
export function createDecoder(onMessage, { maxLength = 64 * 1024 * 1024 } = {}) {
  let chunks = [];
  let size = 0;
  let need = null;
  const take = (n) => {
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    chunks = rest.length ? [rest] : [];
    size = rest.length;
    return out;
  };
  return (chunk) => {
    chunks.push(chunk);
    size += chunk.length;
    for (;;) {
      if (need === null) {
        if (size < 4) return;
        need = take(4).readUInt32LE(0);
        if (need > maxLength) throw new Error(`message too long: ${need}`);
      }
      if (size < need) return;
      const body = take(need).toString('utf8');
      need = null;
      onMessage(JSON.parse(body));
    }
  };
}

// 크롬 → 연결 프로그램은 64MB까지 되지만 연결 프로그램 → 크롬은 1MB(바이트)까지다. 답 글은 그보다 훨씬 짧지만 넘으면 자른다.
export const MAX_REPLY_BYTES = 900 * 1024;
export function limitBytes(text, max = MAX_REPLY_BYTES) {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  // 바이트 기준으로 자르되 글자(한글·이모지) 중간에서 끊지 않는다
  let out = Buffer.from(text, 'utf8').subarray(0, max).toString('utf8');
  if (out.endsWith('\uFFFD')) out = out.slice(0, -1);
  return out;
}

// --- codex 출력에서 터미널 색 코드 지우기
export function stripAnsi(text) {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

// `codex login` 출력에서 로그인 주소와 (기기 코드 방식이면) 일회용 코드를 찾는다.
// OpenAI 로그인 주소(auth.openai.com)만 받는다 (다른 주소를 사용자에게 열어 주지 않도록).
export function parseLoginOutput(output, method) {
  const clean = stripAnsi(output);
  let url = null;
  for (const match of clean.matchAll(/https:\/\/[^\s<>"]+/g)) {
    try {
      const candidate = new URL(match[0]);
      if (candidate.hostname !== 'auth.openai.com') continue;
      if (method === 'device' ? candidate.pathname.includes('/device') : candidate.pathname === '/oauth/authorize') {
        url = candidate.href;
      }
    } catch {
      // 주소가 아니면 넘어간다
    }
  }
  const code = method === 'device' ? (clean.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0] ?? null) : null;
  return { url, code };
}

// --- 모델 목록: `codex debug models` 출력에서 사용자에게 보여 주고(visibility: list) 이미지를 받는 모델만 고른다
export function filterModels(json) {
  const list = Array.isArray(json) ? json : json?.models;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => typeof m?.slug === 'string' && m.visibility === 'list' && (m.input_modalities ?? []).includes('image'))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((m) => ({ slug: m.slug, name: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug }));
}

// 모델 이름은 명령 인자로 들어가므로 영문·숫자·점·하이픈·밑줄만 받는다
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// 온글은 "글과 그림을 받아 답하기"만 하므로 Codex의 도구 기능(명령 실행, 웹·브라우저, 앱·플러그인, 그림 만들기, 하위 에이전트 등)을 끈다.
// 버전마다 기능 이름이 달라지고 없는 이름을 끄라고 하면 Codex가 실패하므로, 실제로 있는 기능만 끈다(availableFeatures).
export const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'remote_plugin',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'multi_agent',
  'hooks',
  'goals',
  'skill_search',
  'tool_suggest'
];

// `codex features list` 출력(한 줄에 "이름 단계 켜짐여부")에서 기능 이름을 모은다
export function parseFeatureNames(output) {
  return new Set(
    stripAnsi(output)
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => /^[a-z0-9_]+$/.test(name ?? ''))
  );
}

// `codex exec` 인자. 질문 글은 인자가 아니라 표준 입력(마지막 '-')으로 보낸다.
// availableFeatures(이 Codex에 있는 기능 이름)는 꼭 받는다. 모르면 끌 기능을 정할 수 없어 실행하지 않는다(도구가 켜진 채 돌지 않게).
export function execArgs({ workDir, outputFile, images = [], model = '', availableFeatures }) {
  if (!(availableFeatures instanceof Set) || !availableFeatures.size) throw new Error('feature list unknown');
  const args = [
    'exec',
    '--ephemeral', // 대화 기록을 남기지 않는다
    '--skip-git-repo-check',
    '--ignore-user-config', // 사용자의 Codex 설정·규칙이 결과를 바꾸지 않게
    '--ignore-rules',
    '--sandbox',
    'read-only', // 모델이 파일을 쓰지 못하게
    '-C',
    workDir, // 빈 임시 폴더
    '-c',
    // 따옴표 없이 쓴다: Codex는 TOML로 읽지 못한 값을 글자로 받고, Windows cmd.exe 실행 줄에는 큰따옴표를 넣을 수 없다
    'web_search=disabled'
  ];
  for (const name of DISABLED_FEATURES) {
    if (availableFeatures.has(name)) args.push('--disable', name);
  }
  if (model) {
    if (!MODEL_PATTERN.test(model)) throw new Error(`bad model name: ${model}`);
    args.push('-m', model);
  }
  for (const image of images) args.push('-i', image);
  args.push('-o', outputFile, '-');
  return args;
}

// 확장에서 온 그림: 형식은 이 셋만 받는다 (파일 확장자를 정해 Codex가 그림으로 알아보게)
export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_IMAGES = 40;

// Codex 실패 출력을 사용자가 들을 한국어 안내로 바꾼다. kind는 확장이 다음 행동을 고르는 데 쓴다.
export function classifyCodexFailure(output) {
  const text = stripAnsi(output);
  if (/not logged in|unauthori[sz]ed|\b401\b|login required|sign in again|token.*(expired|invalid)|refresh token/i.test(text)) {
    return { kind: 'login', message: 'ChatGPT 로그인이 풀렸습니다. 온글 설정에서 ChatGPT 계정으로 다시 로그인하세요.' };
  }
  if (/usage limit|rate limit|too many requests|\b429\b|quota|limit reached|upgrade to/i.test(text)) {
    return {
      kind: 'limit',
      message: 'ChatGPT 사용 한도에 도달했습니다. 잠시 뒤(한도가 풀린 뒤) 다시 시도하거나 온글 설정에서 다른 모델을 고르세요.'
    };
  }
  if (/model/i.test(text) && /not (supported|found|available|exist)|does not exist|unsupported|unknown model|no access/i.test(text)) {
    return { kind: 'model', message: '고른 모델을 지금 ChatGPT 계정에서 쓸 수 없습니다. 온글 설정에서 모델을 다시 고르세요.' };
  }
  if (/network|connect|timed? ?out|dns|offline|stream disconnected/i.test(text)) {
    return { kind: 'network', message: 'ChatGPT 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 잠시 뒤 다시 시도하세요.' };
  }
  return { kind: 'unknown', message: 'ChatGPT가 답을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.' };
}

// codex 실행 파일을 찾을 곳. 크롬이 띄운 연결 프로그램은 PATH가 짧을 수 있어(macOS Dock에서 띄운 크롬 등) 흔한 설치 위치를 함께 본다.
export function codexCandidates({ platform, env, home }) {
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  const sep = platform === 'win32' ? ';' : ':';
  const join = (dir, name) => (platform === 'win32' ? `${dir.replace(/[\\/]+$/, '')}\\${name}` : `${dir.replace(/\/+$/, '')}/${name}`);
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(`${env.APPDATA}\\npm`);
    if (env.LOCALAPPDATA) dirs.push(`${env.LOCALAPPDATA}\\Programs\\codex`);
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.npm-global/bin`, `${home}/.volta/bin`);
  }
  const seen = new Set();
  const out = [];
  for (const dir of dirs) for (const name of names) {
    const file = join(dir, name);
    if (!seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

// Windows의 .cmd(npm으로 설치한 codex)는 cmd.exe로만 실행할 수 있다. 인자는 모두 큰따옴표로 감싸고(그 안의 & | < > 는 글자로 취급됨),
// 따옴표 안에서도 해석되는 큰따옴표·%·줄바꿈이 든 인자는 받지 않는다 (인자는 온글이 만든 것뿐이라 보통 생기지 않음).
export function cmdLine(file, args) {
  for (const part of [file, ...args]) {
    if (/["%\r\n]/.test(part)) throw new Error(`unsafe argument for cmd.exe: ${part}`);
  }
  return `"${[file, ...args].map((part) => `"${part}"`).join(' ')}"`;
}
