// API 키는 동기화되지 않도록 storage.local에만 저장한다.
export const DEFAULT_SETTINGS = {
  aiEnabled: false,
  provider: 'gemini',
  gemini: { apiKey: '', model: 'gemini-3.8-flash' },
  nim: {
    apiKey: '',
    model: 'nvidia/nemotron-nano-12b-v2-vl',
    baseUrl: 'https://integrate.api.nvidia.com/v1'
  }
};

export function mergeSettings(stored = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    gemini: { ...DEFAULT_SETTINGS.gemini, ...stored.gemini },
    nim: { ...DEFAULT_SETTINGS.nim, ...stored.nim }
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
  return { name: settings.provider, config };
}
