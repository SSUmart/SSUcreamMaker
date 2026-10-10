import { DEFAULT_SETTINGS, activeProvider, loadSettings, saveSettings } from '../lib/settings.js';
import { PROVIDERS } from '../lib/providers.js';

const $ = (id) => document.getElementById(id);
const form = $('settings-form');
const status = $('status');

function showProviderSection(provider) {
  $('gemini-settings').hidden = provider !== 'gemini';
  $('nim-settings').hidden = provider !== 'nim';
}

function readForm() {
  return {
    aiEnabled: $('ai-enabled').checked,
    provider: form.elements.provider.value,
    gemini: {
      apiKey: $('gemini-key').value.trim(),
      model: $('gemini-model').value.trim() || DEFAULT_SETTINGS.gemini.model
    },
    nim: {
      apiKey: $('nim-key').value.trim(),
      model: $('nim-model').value.trim() || DEFAULT_SETTINGS.nim.model,
      baseUrl: $('nim-base-url').value.trim() || DEFAULT_SETTINGS.nim.baseUrl
    }
  };
}

async function init() {
  const settings = await loadSettings();
  $('ai-enabled').checked = settings.aiEnabled;
  form.elements.provider.value = settings.provider;
  $('gemini-key').value = settings.gemini.apiKey;
  $('gemini-model').value = settings.gemini.model;
  $('nim-key').value = settings.nim.apiKey;
  $('nim-model').value = settings.nim.model;
  $('nim-base-url').value = settings.nim.baseUrl;
  showProviderSection(settings.provider);
}

form.addEventListener('change', (event) => {
  if (event.target.name === 'provider') showProviderSection(event.target.value);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings(readForm());
  status.textContent = '저장했습니다.';
});

$('test-button').addEventListener('click', async () => {
  const settings = readForm();
  // 연결 확인은 AI 사용이 꺼져 있어도 할 수 있게 한다.
  const active = activeProvider({ ...settings, aiEnabled: true });
  if (active.error) {
    status.textContent = active.error;
    return;
  }
  const provider = PROVIDERS[active.name];
  status.textContent = `${provider.label} 연결 확인 중입니다.`;
  try {
    await provider.test(active.config);
    status.textContent = `${provider.label} 연결에 성공했습니다.`;
  } catch (error) {
    status.textContent = `연결 실패. ${error.message}`;
  }
});

init();
