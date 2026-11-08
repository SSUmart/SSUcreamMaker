import '../content/reader/defaults.js';

const { mergeReaderSettings } = globalThis.__ongeul;

// NVIDIA NIM 추천 모델 후보: 이미지 입력을 받는 모델 중 NVIDIA가 제공 중인 것 (2026-10-14 목록에서 확인).
// NIM은 모델이 자주 바뀌고 종료돼 기본 모델을 두지 않고 사용자가 고른다.
// 한국어 글자 인식 품질은 eval/nim-models.mjs로 비교한 뒤 순서를 정한다.
export const NIM_RECOMMENDED_MODELS = [
  'google/gemma-4-31b-it',
  'google/gemma-3-12b-it',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/llama-3.2-90b-vision-instruct',
  'moonshotai/kimi-k3'
];

// 서비스가 종료된 모델. 예전 설정에 남아 있으면 비워서 새 모델을 고르라고 안내한다.
const RETIRED_NIM_MODELS = ['nvidia/nemotron-nano-12b-v2-vl'];

// API 키는 동기화되지 않도록 storage.local에만 저장한다.
// connection: 'api'(API 키로 Gemini·NIM) 또는 'chatgpt'(ChatGPT 계정 로그인, 연결 프로그램 필요). 설정의 토글로 고르며,
// 모든 AI 기능이 둘 중 하나로만 동작한다(섞어 쓰지 않음). chatgpt.model이 비어 있으면 자동(계정 기본 모델).
export const DEFAULT_SETTINGS = {
  aiEnabled: false,
  connection: 'api',
  chatgpt: { model: '' },
  provider: 'gemini',
  gemini: { apiKey: '', model: 'gemini-3.8-flash' },
  nim: {
    apiKey: '',
    model: '',
    baseUrl: 'https://integrate.api.nvidia.com/v1'
  }
};

export function mergeSettings(stored = {}) {
  const nim = { ...DEFAULT_SETTINGS.nim, ...stored.nim };
  if (RETIRED_NIM_MODELS.includes(nim.model)) nim.model = '';
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    connection: stored.connection === 'chatgpt' ? 'chatgpt' : 'api',
    chatgpt: { model: typeof stored.chatgpt?.model === 'string' ? stored.chatgpt.model : DEFAULT_SETTINGS.chatgpt.model },
    gemini: { ...DEFAULT_SETTINGS.gemini, ...stored.gemini },
    nim,
    // 온글 스크린리더 설정(기능 키, 안내 자세히, 음성)
    ...mergeReaderSettings(stored)
  };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeSettings(settings);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings: mergeSettings(settings) });
}

// 현재 선택된 공급자의 설정과, 사용 불가 시 그 이유를 돌려준다.
// ChatGPT 연결이면 모든 기능을 ChatGPT로 한다. task가 'label'(이름 없는 항목 자동 분석)이면 자동 분석 줄(background)에 세워
// 사용자가 요청한 요약·질문을 오래 붙잡지 않게 한다.
export function activeProvider(settings, { task } = {}) {
  if (!settings.aiEnabled) return { error: 'AI 기능이 꺼져 있습니다. 온글 메뉴에서 온글 설정을 고르고, AI 기능 켜기를 선택한 뒤 연결 방식을 설정하고 저장하세요. 그다음 다시 시도하세요.' };
  if (settings.connection === 'chatgpt') return { name: 'chatgpt', config: { ...settings.chatgpt, background: task === 'label' } };
  return apiProvider(settings);
}

function apiProvider(settings) {
  const config = settings[settings.provider];
  if (!config || settings.provider === 'chatgpt') return { error: `알 수 없는 AI 공급자입니다: ${settings.provider}` };
  if (!config.apiKey.trim()) return { error: 'API 키가 없습니다. 온글 메뉴에서 온글 설정을 고르고, 사용할 AI 공급자의 API 키를 넣고 저장하세요. 그다음 다시 시도하세요.' };
  if (!config.model.trim()) return { error: 'AI 모델을 고르지 않았습니다. 온글 메뉴에서 온글 설정을 고르고, 모델을 고른 뒤 저장하세요. 그다음 다시 시도하세요.' };
  return { name: settings.provider, config };
}
