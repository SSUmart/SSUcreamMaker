import { DEFAULT_SETTINGS, NIM_RECOMMENDED_MODELS, activeProvider, loadSettings, saveSettings } from '../lib/settings.js';
import { PROVIDERS } from '../lib/providers.js';
import { listVoices, pickKoreanVoice, speak } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const form = $('settings-form');
const status = $('status');

// 추천 후보를 "직접 입력" 앞에 넣는다.
const nimChoice = $('nim-model-choice');
for (const model of NIM_RECOMMENDED_MODELS) {
  nimChoice.lastElementChild.before(new Option(`${model} (추천 후보)`, model));
}

const COMMAND_KEY_INPUTS = { summary: 'key-summary', ask: 'key-ask', detail: 'key-detail', explain: 'key-explain', menu: 'key-menu' };
const COMMAND_NAMES = { summary: '페이지 요약', ask: '페이지에 질문하기', detail: '상세 이미지 읽기', explain: '현재 항목 AI 설명', menu: '온글 메뉴' };
const CHROME_COMMANDS = {
  'toggle-reader': '온글 켜기/끄기',
  'open-menu': '온글 메뉴 열기',
  'stop-speech': '읽기 멈춤',
  'reread-current': '현재 위치 다시 읽기'
};

// 기능 키 목록: A부터 Z
for (const select of document.querySelectorAll('.command-key')) {
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    select.append(new Option(letter, `Key${letter}`));
  }
}

// 사용 가이드 전체를 설정 화면에도 보여 준다 (온글 안의 가이드와 같은 내용)
function showGuide(settings, commands) {
  const { guidance, guideContent } = globalThis.__ongeul;
  const shortcut = (name) => guidance.shortcutText(commands.find((c) => c.name === name)?.shortcut ?? '');
  const chapters = guideContent.chapters({
    toggle: shortcut('toggle-reader'),
    menu: shortcut('open-menu'),
    stop: shortcut('stop-speech'),
    reread: shortcut('reread-current'),
    keys: guidance.keyNames(settings.reader.commandKeys)
  });
  $('guide-text').replaceChildren(
    ...chapters.flatMap((chapter, i) => {
      const heading = document.createElement('h3');
      heading.textContent = `${i + 1}장. ${chapter.title}`;
      return [heading, ...chapter.paragraphs.map((text) => Object.assign(document.createElement('p'), { textContent: text }))];
    })
  );
  const toggle = shortcut('toggle-reader');
  const menu = shortcut('open-menu');
  $('start-toggle').textContent = toggle ? `${toggle} 키를 눌러 온글을 켭니다.` : '온글 켜기 단축키가 지정되어 있지 않습니다. 아래 "크롬 단축키" 안내를 참고해 지정합니다.';
  $('start-menu').textContent = `${menu || guidance.keyNames(settings.reader.commandKeys).menu} 키를 눌러 온글 메뉴를 열고, 첫 항목 "사용 가이드"에서 사용법을 듣습니다.`;
}

async function showChromeShortcuts() {
  const commands = await chrome.commands.getAll();
  $('chrome-shortcuts').replaceChildren(
    ...Object.entries(CHROME_COMMANDS).map(([name, label]) => {
      const li = document.createElement('li');
      const shortcut = commands.find((c) => c.name === name)?.shortcut;
      // macOS는 크롬이 ⌥⇧O 같은 기호로 주므로, 읽을 수 있는 키 이름(Option과 Shift와 O)으로 바꿔 보여 준다
      li.textContent = `${label}: ${shortcut ? globalThis.__ongeul.guidance.shortcutText(shortcut) : '지정 안 됨'}`;
      if (!shortcut) li.className = 'missing';
      return li;
    })
  );
  $('shortcut-missing').hidden = !globalThis.__ongeul.guidance.needsShortcutSetup(commands);
}

async function showVoices(selected) {
  const voices = (await listVoices()).filter((v) => (v.lang ?? '').toLowerCase().startsWith('ko'));
  const select = $('speech-voice');
  select.replaceChildren(new Option('자동 (이 기기의 기본 한국어 음성)', ''));
  for (const v of voices) {
    select.append(new Option(`${v.voiceName}${v.remote ? ' (인터넷 음성: 읽는 글이 외부 서버로 전송됨)' : ''}`, v.voiceName));
  }
  select.value = voices.some((v) => v.voiceName === selected) ? selected : '';
  $('speech-voice-help').textContent = voices.some((v) => !v.remote)
    ? '자동은 이 기기에 설치된 한국어 음성만 씁니다. 인터넷 음성은 읽는 글(편집창에 쓴 글 포함)이 음성 서비스로 전송되므로 직접 고를 때만 씁니다.'
    : '이 기기에 설치된 한국어 음성이 없습니다. Windows는 설정, 시간 및 언어, 음성에서 한국어 음성을 추가하세요. 추가하기 전에는 브라우저 기본 음성으로 읽습니다.';
}

const RESERVED = globalThis.__ongeul.defaults.reservedCommandKeys;

// 영문 글자 이름을 읽는 소리에 맞춘 조사: 엘·엠·엔·알은 받침이 있어 "은", 나머지는 "는"
function keyWithTopic(letter) {
  return `${letter}${'LMNR'.includes(letter) ? '은' : '는'}`;
}

// 기능 키는 서로 달라야 하고 다른 명령의 글자와 겹치면 안 된다. 문제가 있으면 안내 문장을 돌려준다.
function validateReader(reader) {
  const used = new Map();
  for (const [name, code] of Object.entries(reader.commandKeys)) {
    if (RESERVED[code]) {
      return `${COMMAND_NAMES[name]}의 기능 키 ${keyWithTopic(code.slice(3))} 이미 ${RESERVED[code]}에 쓰는 키입니다. 다른 글자를 고르세요.`;
    }
    if (used.has(code)) {
      return `${COMMAND_NAMES[used.get(code)]}, ${COMMAND_NAMES[name]}의 기능 키가 둘 다 ${code.slice(3)}입니다. 서로 다른 글자를 고르세요.`;
    }
    used.set(code, name);
  }
  return '';
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
    },
    reader: {
      commandKeys: Object.fromEntries(Object.entries(COMMAND_KEY_INPUTS).map(([name, id]) => [name, $(id).value])),
      verbosity: form.elements.verbosity.value || 'auto',
      captionPosition: form.elements.caption.value || 'bottom',
      autoSupplement: $('auto-supplement').checked
    },
    braille: {
      grade: Number(form.elements['braille-grade'].value) === 1 ? 1 : 2,
      cells: Number($('braille-cells').value) || 40,
      adminTools: $('braille-admin').checked
    },
    speech: {
      voiceName: $('speech-voice').value,
      rate: Math.min(3, Math.max(0.5, Number($('speech-rate').value) || 1))
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
  for (const [name, id] of Object.entries(COMMAND_KEY_INPUTS)) $(id).value = settings.reader.commandKeys[name];
  form.elements.verbosity.value = settings.reader.verbosity;
  form.elements.caption.value = settings.reader.captionPosition;
  $('auto-supplement').checked = settings.reader.autoSupplement;
  form.elements['braille-grade'].value = String(settings.braille.grade);
  $('braille-cells').value = String(settings.braille.cells);
  $('braille-admin').checked = settings.braille.adminTools;
  $('speech-rate').value = settings.speech.rate;
  await showVoices(settings.speech.voiceName);
  await showChromeShortcuts();
  showGuide(settings, await chrome.commands.getAll());
}

$('speech-test').addEventListener('click', async () => {
  const { speech } = readForm();
  const voice = pickKoreanVoice(await listVoices(), speech.voiceName);
  speak('온글 음성입니다. 이 속도로 페이지를 읽습니다.', { voiceName: voice?.voiceName, rate: speech.rate });
});

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
  const problem = validateReader(settings.reader);
  if (problem) {
    status.textContent = `저장하지 않았습니다. ${problem}`;
    return;
  }
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
