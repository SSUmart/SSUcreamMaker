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
export const DEFAULT_SETTINGS = {
  aiEnabled: false,
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
    gemini: { ...DEFAULT_SETTINGS.gemini, ...stored.gemini },
    nim
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
export function activeProvider(settings) {
  if (!settings.aiEnabled) return { error: 'AI 설정이 꺼져 있습니다. 확장 프로그램 옵션에서 켜주세요.' };
  const config = settings[settings.provider];
  if (!config) return { error: `알 수 없는 AI 공급자입니다: ${settings.provider}` };
  if (!config.apiKey.trim()) return { error: 'API 키가 없습니다. 확장 프로그램 옵션에서 입력해주세요.' };
  if (!config.model.trim()) return { error: 'AI 모델을 고르지 않았습니다. 확장 프로그램 옵션에서 모델을 골라주세요.' };
  return { name: settings.provider, config };
}
