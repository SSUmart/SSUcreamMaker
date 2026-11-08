import { DEFAULT_SETTINGS, NIM_RECOMMENDED_MODELS, activeProvider, loadSettings, saveSettings } from '../lib/settings.js';
import { PROVIDERS } from '../lib/providers.js';
import { userMessage } from '../lib/errors.js';
import { BRIDGE_GUIDE_URL, bridgeRequest, bridgeState, spellCode } from '../lib/chatgpt.js';
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

// ChatGPT 연결 토글: 켜면 ChatGPT 칸만, 끄면 API 키 칸만 보인다 (둘 중 하나로만 동작)
function showConnectionSection(connection) {
  $('chatgpt-settings').hidden = connection !== 'chatgpt';
  $('api-settings').hidden = connection === 'chatgpt';
  if (connection === 'chatgpt') void refreshChatgpt();
}

// --- ChatGPT 계정 (온글 연결 프로그램)
const chatgptModel = $('chatgpt-model');
$('chatgpt-guide').href = BRIDGE_GUIDE_URL;
let loginAbort = null;
let chatgptReady = false;

function setChatgptButtons({ installed = false, loggedIn = false } = {}) {
  const loggingIn = Boolean(loginAbort);
  $('chatgpt-login').hidden = loggingIn || !installed || loggedIn;
  $('chatgpt-device').hidden = loggingIn || !installed || loggedIn;
  $('chatgpt-cancel').hidden = !loggingIn;
  $('chatgpt-logout').hidden = loggingIn || !installed || !loggedIn;
  $('chatgpt-models-refresh').disabled = !loggedIn;
}

// 연결 상태를 확인해 화면에 보여 주고, 로그인돼 있으면 모델 목록을 받는다. announce면 결과를 상태 줄로 읽어 준다.
async function refreshChatgpt({ announce = false } = {}) {
  const state = $('chatgpt-state');
  let text;
  let info = {};
  try {
    info = await bridgeState();
    if (!info.installed) text = '온글 연결 프로그램이 이 컴퓨터에 설치되어 있지 않습니다.';
    else if (info.outdated) text = '온글 연결 프로그램이 이 온글 버전과 맞지 않습니다. 새 연결 프로그램을 받아 설치를 다시 실행하세요.';
    else if (!info.codex) text = '온글 연결 프로그램은 있지만 Codex CLI를 찾지 못했습니다. 설치 안내에 따라 Codex CLI를 설치한 뒤 연결 프로그램 설치를 다시 실행하세요.';
    else if (info.loggedIn) text = 'ChatGPT 계정에 로그인되어 있습니다.';
    else text = 'ChatGPT 계정에 로그인되어 있지 않습니다. ChatGPT 로그인 버튼을 누르세요.';
  } catch (error) {
    text = `연결 상태를 확인하지 못했습니다. ${userMessage(error)}`;
  }
  state.textContent = text;
  $('chatgpt-install').hidden = Boolean(info.installed && info.codex && !info.outdated);
  chatgptReady = Boolean(info.loggedIn);
  setChatgptButtons({ installed: Boolean(info.installed && info.codex && !info.outdated), loggedIn: info.loggedIn });
  if (announce) status.textContent = text;
  if (info.loggedIn) await loadModels();
}

// 저장된 모델이 목록에 없으면(요금제가 바뀌었거나 모델이 사라짐) 자동으로 돌리고 알린다
async function loadModels({ announce = false } = {}) {
  const saved = chatgptModel.value;
  try {
    const { models } = await bridgeRequest('models');
    chatgptModel.replaceChildren(new Option('자동 (계정 기본 모델)', ''), ...models.map((m) => new Option(m.name, m.slug)));
    if (saved && !models.some((m) => m.slug === saved)) {
      chatgptModel.value = '';
      status.textContent = `고른 모델 ${saved}을 지금 계정에서 쓸 수 없어 자동으로 바꿨습니다. 저장을 누르면 반영됩니다.`;
    } else {
      chatgptModel.value = saved;
      if (announce) status.textContent = `모델 목록을 받았습니다. 자동을 포함해 ${models.length + 1}개입니다.`;
    }
  } catch (error) {
    status.textContent = `모델 목록을 받지 못했습니다. ${userMessage(error)}`;
  }
}

async function login(method) {
  loginAbort = new AbortController();
  setChatgptButtons({ installed: true });
  const info = $('chatgpt-login-info');
  const link = $('chatgpt-login-link');
  const code = $('chatgpt-code');
  info.hidden = true;
  status.textContent = method === 'device' ? '기기 코드를 받는 중입니다.' : 'OpenAI 로그인 페이지를 여는 중입니다.';
  try {
    await bridgeRequest('login', { method }, {
      signal: loginAbort.signal,
      onProgress(progress) {
        if (!progress.url) return;
        link.href = progress.url;
        info.hidden = false;
        if (method === 'device' && progress.code) {
          $('chatgpt-login-text').textContent =
            '아래 로그인 페이지를 열어 ChatGPT 계정으로 로그인한 뒤 일회용 코드를 입력하세요. 다른 기기(휴대폰 등)에서 같은 주소로 들어가도 됩니다. 코드는 15분 동안 쓸 수 있습니다.';
          code.textContent = `일회용 코드: ${progress.code} (한 글자씩: ${spellCode(progress.code)})`;
          status.textContent = `일회용 코드는 ${spellCode(progress.code)}입니다. 로그인 페이지 열기 링크를 눌러 코드를 입력하세요.`;
        } else {
          $('chatgpt-login-text').textContent =
            'OpenAI 로그인 페이지가 기본 브라우저에 열렸습니다. 열리지 않았으면 아래 링크를 누르세요. 로그인을 마치면 이 설정 화면으로 돌아오세요.';
          code.textContent = '';
          status.textContent = 'OpenAI 로그인 페이지가 기본 브라우저에 열렸습니다. 로그인을 마치면 이 화면으로 돌아오세요.';
        }
      }
    });
    status.textContent = 'ChatGPT에 로그인했습니다.';
  } catch (error) {
    status.textContent = error.kind === 'cancelled' ? '로그인을 취소했습니다.' : `로그인하지 못했습니다. ${userMessage(error)}`;
  } finally {
    loginAbort = null;
    info.hidden = true;
    // 상태 줄은 그대로 두고 화면(버튼·모델 목록)만 새로 고친다
    await refreshChatgpt();
  }
}

$('chatgpt-login').addEventListener('click', () => login('browser'));
$('chatgpt-device').addEventListener('click', () => login('device'));
$('chatgpt-cancel').addEventListener('click', () => loginAbort?.abort());
$('chatgpt-recheck').addEventListener('click', () => refreshChatgpt({ announce: true }));
$('chatgpt-models-refresh').addEventListener('click', () => loadModels({ announce: true }));
$('chatgpt-logout').addEventListener('click', async () => {
  try {
    const { remains } = await bridgeRequest('logout');
    status.textContent = remains
      ? '로그아웃했지만 인증 파일이 남아 있습니다. 로그아웃을 다시 눌러 보세요.'
      : 'ChatGPT에서 로그아웃했습니다.';
  } catch (error) {
    status.textContent = `로그아웃하지 못했습니다. ${userMessage(error)}`;
  }
  await refreshChatgpt();
});

function readForm() {
  return {
    aiEnabled: $('ai-enabled').checked,
    connection: $('use-chatgpt').checked ? 'chatgpt' : 'api',
    chatgpt: { model: chatgptModel.value },
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
      newTab: form.elements.newtab.value === 'chrome' ? 'chrome' : 'google',
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
  $('use-chatgpt').checked = settings.connection === 'chatgpt';
  // 목록을 받기 전에도 저장된 모델이 보이게 넣어 둔다
  if (settings.chatgpt.model) chatgptModel.append(new Option(settings.chatgpt.model, settings.chatgpt.model));
  chatgptModel.value = settings.chatgpt.model;
  showConnectionSection(settings.connection);
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
  form.elements.newtab.value = settings.reader.newTab;
  // 설정 화면을 열어 둔 채 음성 질문에서 새 탭을 바꾸면 화면도 바꿔, 나중에 저장할 때 예전 값으로 덮어쓰지 않게 한다
  chrome.storage.onChanged.addListener((changes, area) => {
    const newTab = changes.settings?.newValue?.reader?.newTab;
    if (area === 'local' && newTab) form.elements.newtab.value = newTab;
  });
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
  if (event.target.id === 'use-chatgpt') showConnectionSection(event.target.checked ? 'chatgpt' : 'api');
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
    settings.connection === 'chatgpt'
      ? chatgptReady
        ? '저장했습니다. ChatGPT 계정으로 연결합니다.'
        : '저장했습니다. ChatGPT 계정에 아직 로그인하지 않았습니다. ChatGPT 로그인 버튼을 누르세요.'
      : settings.provider === 'nim' && !settings.nim.model
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
    status.textContent = `연결 실패. ${userMessage(error)}`;
  }
});

init();
