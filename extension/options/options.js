import { DEFAULT_SETTINGS, NIM_RECOMMENDED_MODELS, activeProvider, loadSettings, saveSettings } from '../lib/settings.js';
import { PROVIDERS } from '../lib/providers.js';

const $ = (id) => document.getElementById(id);
const form = $('settings-form');
const status = $('status');

// 추천 후보를 "직접 입력" 앞에 넣는다.
const nimChoice = $('nim-model-choice');
for (const model of NIM_RECOMMENDED_MODELS) {
  nimChoice.lastElementChild.before(new Option(`${model} (추천 후보)`, model));
}

function showNimCustom() {
  $('nim-model-custom-row').hidden = nimChoice.value !== 'custom';
}

function nimModel() {
  return nimChoice.value === 'custom' ? $('nim-model-custom').value.trim() : nimChoice.value;
}

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
      model: nimModel(),
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
  // 추천 후보면 목록에서 고르고, 아니면 직접 입력 칸에 넣는다.
  const model = settings.nim.model;
  nimChoice.value = !model || NIM_RECOMMENDED_MODELS.includes(model) ? model : 'custom';
  $('nim-model-custom').value = nimChoice.value === 'custom' ? model : '';
  showNimCustom();
  $('nim-base-url').value = settings.nim.baseUrl;
  showProviderSection(settings.provider);
}

form.addEventListener('change', (event) => {
  if (event.target.name === 'provider') showProviderSection(event.target.value);
  if (event.target === nimChoice) {
    showNimCustom();
    if (nimChoice.value === 'custom') $('nim-model-custom').focus();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = readForm();
  await saveSettings(settings);
  status.textContent =
    settings.provider === 'nim' && !settings.nim.model
      ? '저장했습니다. NVIDIA NIM 모델을 아직 고르지 않았습니다.'
      : '저장했습니다.';
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
