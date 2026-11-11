// ChatGPT 계정 연결: PC에 설치한 온글 연결 프로그램(bridge/host.mjs)과 Native Messaging으로 이야기한다.
// 로그인과 AI 호출은 연결 프로그램이 OpenAI 공식 Codex CLI로 하고, 온글은 인증 정보를 보지 않는다.
// 설치·사용: docs/CHATGPT-LOGIN.md

export const HOST_NAME = 'me.jaymong.ongeul';
// 연결 프로그램과 주고받는 메시지 모양의 버전 (bridge/protocol.mjs의 PROTOCOL과 같아야 함)
export const PROTOCOL = 1;
export const BRIDGE_GUIDE_URL = 'https://github.com/SSUmart/SSUcreamMaker/blob/main/docs/CHATGPT-LOGIN.md';

export const NO_BRIDGE_MESSAGE =
  '온글 연결 프로그램이 설치되어 있지 않습니다. ChatGPT 계정으로 쓰려면 온글 설정의 안내에 따라 통합 zip의 설치 파일을 실행하세요. API 키로 쓰려면 온글 설정에서 연결 방식을 API 키로 바꾸세요.';

function bridgeError(message, kind) {
  return Object.assign(new Error(message), { kind });
}

// 요청 하나를 보내고 결과를 기다린다. 크롬은 연결마다 연결 프로그램을 새로 띄우고, 연결을 끊으면 연결 프로그램도 하던 일을 멈춘다.
// onProgress: 진행 메시지(로그인 주소 등), signal: 취소(AbortSignal)
// 연결 프로그램이 멈춰 답하지 않을 때를 대비한 상한 (연결 프로그램의 가장 긴 제한 시간: 로그인 15분, 답 만들기 10분 + 여유)
const REQUEST_TIMEOUT_MS = { login: 16 * 60_000, generate: 11 * 60_000 };
const DEFAULT_TIMEOUT_MS = 60_000;

export function bridgeRequest(type, payload = {}, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      console.warn('연결 프로그램 연결 실패', error);
      reject(bridgeError(NO_BRIDGE_MESSAGE, 'no-bridge'));
      return;
    }
    let settled = false;
    const timer = setTimeout(
      () => finish(reject, bridgeError('온글 연결 프로그램이 오래 답하지 않아 멈췄습니다. 잠시 뒤 다시 시도하세요.', 'timeout')),
      REQUEST_TIMEOUT_MS[type] ?? DEFAULT_TIMEOUT_MS
    );
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        port.disconnect();
      } catch {
        // 이미 끊겼다
      }
      fn(value);
    };
    const abort = () => finish(reject, bridgeError('취소했습니다.', 'cancelled'));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort);
    port.onMessage.addListener((message) => {
      if (message?.type === 'progress') onProgress?.(message);
      else if (message?.type === 'result') finish(resolve, message);
      else if (message?.type === 'error') finish(reject, bridgeError(message.message, message.kind));
    });
    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message ?? '';
      if (settled) return;
      console.warn('연결 프로그램 연결이 끊김', reason);
      finish(
        reject,
        /not found|forbidden|access to the specified native messaging host/i.test(reason)
          ? bridgeError(NO_BRIDGE_MESSAGE, 'no-bridge')
          : bridgeError('온글 연결 프로그램이 응답 도중 멈췄습니다. 잠시 뒤 다시 시도하세요.', 'bridge-exit')
      );
    });
    port.postMessage({ id: 1, type, ...payload });
  });
}

// 연결 프로그램과 Codex가 준비됐는지, 로그인했는지 한 번에 확인한다.
export async function bridgeState() {
  let hello;
  try {
    hello = await bridgeRequest('hello');
  } catch (error) {
    if (error.kind === 'no-bridge') return { installed: false };
    throw error;
  }
  if (hello.protocol !== PROTOCOL) return { installed: true, outdated: true, bridge: hello.bridge };
  if (!hello.codex) return { installed: true, codex: null, loggedIn: false, bridge: hello.bridge };
  const { loggedIn } = await bridgeRequest('status');
  return { installed: true, codex: hello.codex, loggedIn, bridge: hello.bridge };
}

// 동시에 여러 개를 실행하지 않게 줄을 세운다. 사용자가 요청한 일(요약·질문 등)과 자동 보완(이름 없는 항목)은 줄을 따로 써서,
// 페이지를 열 때 미리 하는 자동 보완 여러 개가 사용자 요청을 오래 붙잡지 않게 한다.
const queues = { user: Promise.resolve(), background: Promise.resolve() };
function enqueue(lane, task) {
  const run = queues[lane].then(task, task);
  queues[lane] = run.catch(() => {});
  return run;
}

// 글과 (있으면) 그림 조각을 보내 답 글을 받는다. 고른 모델을 지금 계정에서 쓸 수 없으면 자동(계정 기본 모델)으로 한 번 다시 시도한다.
export function generate(prompt, tiles, config, onProgress = () => {}) {
  const images = tiles.map((t) => ({ mimeType: t.mimeType, data: t.data }));
  return enqueue(config.background ? 'background' : 'user', async () => {
    try {
      return (await bridgeRequest('generate', { prompt, images, model: config.model })).text;
    } catch (error) {
      if (error.kind !== 'model' || !config.model) throw error;
      onProgress('고른 모델을 지금 계정에서 쓸 수 없어 자동 모델로 다시 시도합니다');
      return (await bridgeRequest('generate', { prompt, images, model: '' })).text;
    }
  });
}

// 기기 코드를 한 글자씩 읽을 수 있게 쉼표로 띄운다 (5X07-5HD07 → 5, X, 0, 7, 붙임표, 5, H, D, 0, 7)
export function spellCode(code) {
  return [...code].map((ch) => (ch === '-' ? '붙임표' : ch)).join(', ');
}
