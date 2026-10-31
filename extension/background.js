import { activeProvider, loadSettings } from './lib/settings.js';
import { pickDetailImages } from './lib/detect.js';
import { cutTiles } from './lib/tiles.js';
import { PROVIDERS } from './lib/providers.js';
import { userMessage } from './lib/errors.js';
import { parseSections } from './lib/structure.js';
import { buildQuestionPrompt, buildSummaryPrompt, parseAnswer, parseSummary } from './lib/answer.js';
import { MAX_EXPLAIN_TILES, buildExplainPrompt, buildLabelPrompt, parseExplanation, parseLabel } from './lib/explain.js';
import { listVoices, pickKoreanVoice, speak } from './lib/speech.js';
import './content/reader/guidance.js';

const { guidance } = globalThis.__ongeul;

// 한 번에 AI로 보내는 조각 수 상한. 사용자 API 요금이 과하게 나오지 않도록 한다.
const MAX_TILES = 40;

// 온글 스크린리더 스크립트 (manifest의 content_scripts와 같은 순서)
const READER_FILES = chrome.runtime.getManifest().content_scripts[0].js;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
    // 설치 직후 시작 안내를 소리로 읽는다 (온글은 꺼진 상태로 시작하므로 켜는 법과 가이드 찾는 법을 알린다)
    guideFromWorker('welcome');
  }
  // 설치·업데이트 전에 열려 있던 탭에는 온글이 없으므로 넣어 준다 (새로고침하지 않아도 읽도록)
  if (reason === 'install' || reason === 'update') {
    injectReaderIntoOpenTabs();
    guideShortcutSetup(reason);
  }
});

// 크롬은 기본 단축키를 최초 설치 때만 지정해, 업데이트 뒤에는 온글 켜기 단축키가 빌 수 있다.
// 비어 있으면 크롬 단축키 설정 화면을 열고 할 일을 소리로 알린다. 지정돼 있으면 아무것도 하지 않는다.
async function guideShortcutSetup(reason) {
  if (!guidance.needsShortcutSetup(await chrome.commands.getAll())) return;
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
  // 설치 때는 시작 안내를 끊지 않고 이어서 읽는다
  speakWithSettings(await guidanceText('shortcut-missing'), { interrupt: reason !== 'install' });
}

async function injectReaderIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file://*/*'] });
  await Promise.all(
    tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: READER_FILES }).catch(() => {}))
  );
}

// 단축키별로 페이지에 넣을 content script. page-text.js는 요약·질문 응답이 같이 쓴다.
const COMMAND_FILES = {
  'read-detail': ['content/page-text.js', 'content/detail.js'],
  'summarize-page': ['content/page-text.js', 'content/summary.js'],
  'ask-page': ['content/page-text.js', 'content/qa.js'],
  'explain-mode': ['content/page-text.js', 'content/explain.js']
};

chrome.action.onClicked.addListener((tab) => runOnTab(tab, 'read-detail'));
chrome.commands.onCommand.addListener((command, tab) => {
  if (READER_COMMANDS[command]) READER_COMMANDS[command](tab);
  else if (COMMAND_FILES[command]) runOnTab(tab, command);
});

// 크롬 단축키 4개(기본값)는 웹페이지 밖(주소창 등)에서도 동작해야 하는 것에만 쓴다.
// 나머지 기능은 같은 조합(Alt+Shift)의 페이지 안 명령과 온글 메뉴로 실행한다 (크롬은 기본 단축키를 4개까지만 허용).
const READER_COMMANDS = {
  'toggle-reader': () => toggleReader(),
  'open-menu': (tab) => sendReaderCommand(tab, 'ongeul-open-menu', { action: '온글 메뉴를 열', result: '온글 메뉴가 열립니다.' }),
  'reread-current': (tab) => sendReaderCommand(tab, 'ongeul-reread', { action: '현재 위치를 읽을', result: '읽던 위치를 다시 읽습니다.' }),
  'stop-speech': (tab) => stopSpeech(tab)
};

// 안내 문장 만들기. "자동" 안내의 읽은 횟수는 서비스 워커 한 곳에서 센다 (탭끼리 덮어쓰지 않게, 순서대로 처리)
let guidanceQueue = Promise.resolve();
function guidanceText(id, params = {}) {
  const task = guidanceQueue.then(async () => {
    const settings = await loadSettings();
    const { guidanceSeen = {} } = await chrome.storage.local.get('guidanceSeen');
    const shortcuts = await shortcutTexts();
    const text = guidance.message(
      id,
      { toggle: shortcuts.toggle, menu: shortcuts.menu, keys: guidance.keyNames(settings.reader.commandKeys), ...params },
      { verbosity: settings.reader.verbosity, seen: guidanceSeen[id] ?? 0 }
    );
    guidanceSeen[id] = (guidanceSeen[id] ?? 0) + 1;
    await chrome.storage.local.set({ guidanceSeen });
    return text;
  });
  guidanceQueue = task.catch(() => {});
  return task;
}

// 서비스 워커가 직접 읽는 안내 (온글을 넣을 수 없는 페이지, 주소창에 초점이 있을 때, 켜기/끄기)
async function guideFromWorker(id, params = {}) {
  return speakWithSettings(await guidanceText(id, params), { interrupt: true });
}

// 온글 스크립트가 응답하지 않는 탭에 대한 안내: 일반 웹페이지면 새로고침 안내, 아니면 읽을 수 없는 페이지 안내
function noReaderGuide(tab, prefix = '') {
  // 제목 끝의 마침표는 지운다 (안내 문장이 "제목." 뒤에 이어지므로 마침표가 겹치지 않게)
  const title = [prefix, tab?.title].filter(Boolean).join(' ').replace(/[.\s]+$/, '');
  const url = tab?.url ?? '';
  const webPage = /^(https?|file):/.test(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url) && !/\.pdf($|[?#])/i.test(url);
  return guideFromWorker(webPage ? 'reload-needed' : 'unreadable-page', { title });
}

// 사용자가 정한 음성·속도로 읽는다. 화살표를 누를 때마다 읽으므로 음성 설정은 저장해 두고 설정이 바뀔 때만 다시 읽는다.
let voiceSettings = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) voiceSettings = null;
});

async function currentVoice() {
  if (!voiceSettings) {
    const settings = await loadSettings();
    const voice = pickKoreanVoice(await listVoices(), settings.speech.voiceName);
    voiceSettings = { voiceName: voice?.voiceName, rate: settings.speech.rate };
  }
  return voiceSettings;
}

async function speakWithSettings(text, { interrupt = true } = {}) {
  const { voiceName, rate } = await currentVoice();
  return speak(text, { voiceName, rate, enqueue: !interrupt });
}

// 현재 크롬 단축키를 읽는 말로 ("Alt와 Shift와 O"). 사용자가 바꿨으면 바꾼 키를 쓴다.
async function shortcutTexts() {
  const commands = await chrome.commands.getAll();
  const text = (name) => guidance.shortcutText(commands.find((c) => c.name === name)?.shortcut ?? '');
  return { toggle: text('toggle-reader'), menu: text('open-menu'), stop: text('stop-speech'), reread: text('reread-current') };
}

// 온글 켜기/끄기. 켜짐 여부는 storage.local에 두어 모든 탭의 content script가 따른다.
// 켤 때 안내는 보이는 탭의 온글이 페이지 정보와 함께 읽고, 그 탭이 온글을 넣을 수 없는 페이지면 서비스 워커가 읽는다.
async function toggleReader(force) {
  const { readerEnabled } = await chrome.storage.local.get('readerEnabled');
  const next = force ?? !readerEnabled;
  chrome.tts.stop();
  await chrome.storage.local.set({ readerEnabled: next });
  if (!next) {
    await guideFromWorker('reader-off');
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const answered = tab && (await chrome.tabs.sendMessage(tab.id, { type: 'ongeul-ping' }).catch(() => null));
  if (!answered) await noReaderGuide(tab, '온글이 켜졌습니다.');
}

// 메뉴 열기·다시 읽기: 탭의 온글에 맡기고, 할 수 없는 상황이면 이유와 방법을 안내한다
async function sendReaderCommand(tab, type, { action, result }) {
  const response = tab ? await chrome.tabs.sendMessage(tab.id, { type }).catch(() => null) : null;
  if (!response) return noReaderGuide(tab);
  if (response.state === 'off') return guideFromWorker('reader-off-command', { action });
  if (response.state === 'unfocused') return guideFromWorker('focus-outside-page', { action, result });
}

function stopSpeech(tab) {
  chrome.tts.stop();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'ongeul-stop-all' }).catch(() => {});
}

// 탭을 바꾸면 그 탭의 온글이 제목과 현재 항목을 읽는다. 온글을 넣을 수 없는 페이지면 그렇다고 알린다.
async function announceTab(tabId) {
  const { readerEnabled } = await chrome.storage.local.get('readerEnabled');
  if (!readerEnabled) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status !== 'complete') return;
  const answered = await chrome.tabs.sendMessage(tabId, { type: 'ongeul-tab-activated' }).catch(() => null);
  if (!answered) await noReaderGuide(tab);
}

chrome.tabs.onActivated.addListener(({ tabId }) => announceTab(tabId));
// 같은 탭에서 페이지를 옮겼을 때: 온글이 들어가지 못한 페이지(chrome://, 웹스토어, PDF)면 서비스 워커가 알린다.
// 일반 페이지는 온글이 스스로 읽으므로, 온글이 자리 잡을 시간을 준 뒤 응답이 없을 때만 알린다.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.active) return;
  setTimeout(async () => {
    const { readerEnabled } = await chrome.storage.local.get('readerEnabled');
    if (!readerEnabled) return;
    const answered = await chrome.tabs.sendMessage(tabId, { type: 'ongeul-ping' }).catch(() => null);
    const latest = await chrome.tabs.get(tabId).catch(() => null);
    if (!answered && latest?.active) await noReaderGuide(latest);
  }, 1500);
});

// 페이지의 온글이 보내는 요청: 읽기(음성), 멈춤, 단축키 이름, 설정 열기
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  switch (message?.type) {
    case 'ongeul-say':
      speakWithSettings(message.text, { interrupt: message.interrupt }).then(sendResponse);
      return true;
    case 'ongeul-stop':
      chrome.tts.stop();
      return;
    case 'ongeul-shortcuts':
      shortcutTexts().then(sendResponse);
      return true;
    case 'ongeul-guide-text':
      guidanceText(message.id, message.params).then((text) => sendResponse({ text }));
      return true;
    case 'ongeul-toggle':
      toggleReader(message.enabled);
      return;
    case 'ongeul-open-options':
      chrome.runtime.openOptionsPage();
      return;
    default:
      return;
  }
});

// 페이지 안 명령(요약, 질문, 상세 이미지 읽기)을 content script가 요청하면 기존 기능을 실행한다
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'ongeul-run' || sender.id !== chrome.runtime.id || !sender.tab) return;
  if (COMMAND_FILES[message.command]) runOnTab(sender.tab, message.command);
});

async function runOnTab(tab, command) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: COMMAND_FILES[command] });
  } catch (error) {
    // chrome:// 같은 페이지에는 주입할 수 없다.
    console.warn('content script 주입 실패', error);
  }
}

// 음성 확인 페이지(check/tts.html)가 서비스 워커에서 읽기를 시험할 때 쓴다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'speech-check' || sender.id !== chrome.runtime.id) return;
  speak(message.text, message.options).then(sendResponse);
  return true;
});

const HANDLERS = {
  'extract-detail': (message, progress) => extractDetail(message.urls, progress),
  'summarize-page': (message, progress) => summarizePage(message.page, progress),
  'ask-page': (message) => askPage(message.page, message.question, message.history),
  'explain-item': (message, progress) => explainItem(message.item, progress),
  'label-item': (message) => labelItem(message.item)
};

// 사용자가 듣는 오류 문장. 온글이 만든 한국어 오류는 그대로, 그 밖의 오류(영어 원문, 오류 코드, JSON)는 일반 안내로 바꾸고
// 원문은 서비스 워커 콘솔에만 남긴다 (lib/errors.js)
const userError = (error) => userMessage(error);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler || !sender.tab?.id) return;
  // 진행 안내는 어느 작업의 것인지(task) 함께 보낸다 (요약 중에 상세 이미지 안내 영역이 읽지 않게)
  const progress = (text) =>
    chrome.tabs.sendMessage(sender.tab.id, { type: 'progress', task: message.type, text }).catch(() => {});
  handler(message, progress).then(sendResponse, (error) => sendResponse({ error: userError(error) }));
  return true;
});

// 오래 걸리는 AI 요청 동안 다른 진행 안내가 15초 넘게 없으면 지난 시간을 알린다.
// 멈춘 것처럼 보이지 않게 하되, 같은 문장을 몇 초마다 되풀이하지 않도록 간격을 두고 시간을 넣어 문장을 바꾼다.
const HEARTBEAT_MS = 15_000;
function startHeartbeat(progress, label) {
  const started = Date.now();
  let last = started;
  let stopped = false;
  // 작업이 끝난(실패한) 뒤에 늦게 온 진행 안내는 보내지 않는다 (오류 안내를 덮지 않도록)
  const report = (text) => {
    if (stopped) return;
    last = Date.now();
    progress(text);
  };
  const timer = setInterval(() => {
    if (Date.now() - last >= HEARTBEAT_MS) report(`${label}, ${Math.round((Date.now() - started) / 1000)}초 지남`);
  }, 1000);
  return {
    report,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}

async function extractDetail(urls, progress) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  const provider = PROVIDERS[active.name];

  const cacheKey = await makeCacheKey('detail', active, urls);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  progress(`이미지 ${urls.length}개 확인 중`);
  const { images, failedCount } = await loadImages(urls);
  const picked = pickDetailImages(images);
  if (!picked.length) {
    return { error: '상세 설명 이미지를 찾지 못했습니다. 상세 정보 탭이 닫혀 있다면 연 뒤 다시 시도해주세요.' };
  }

  let tiles = [];
  for (const image of picked) {
    const bitmap = await createImageBitmap(image.blob);
    tiles.push(...(await cutTiles(bitmap, { maxBase64Length: provider.maxBase64Length })));
    bitmap.close();
  }
  const truncated = tiles.length > MAX_TILES;
  tiles = tiles.slice(0, MAX_TILES);

  const label = `상세 이미지 ${picked.length}개를 ${provider.label}로 읽는 중`;
  const heartbeat = startHeartbeat(progress, label);
  heartbeat.report(`${label}. 보통 1분 안팎 걸립니다`);
  let text;
  try {
    text = await provider.extract(tiles, active.config, heartbeat.report);
  } finally {
    heartbeat.stop();
  }
  const sections = parseSections(text);
  const result = { sections, imageCount: picked.length, firstUrl: picked[0].url, truncated, failedCount };
  await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// 이미지를 사용자 브라우저에서 직접 내려받아 실제 크기를 확인한다.
async function loadImages(urls) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      bitmap.close();
      return { url, blob, width, height };
    })
  );
  const images = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  return { images, failedCount: results.length - images.length };
}

// F4 요약: 같은 페이지 글·같은 모델이면 캐시를 쓴다.
async function summarizePage(page, progress = () => {}) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  if (!page?.paragraphs?.length) return { error: '요약할 글을 찾지 못했습니다.' };

  const cacheKey = await makeCacheKey('summary', active, [page.title, ...page.paragraphs]);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  const heartbeat = startHeartbeat(progress, '페이지 글을 요약하는 중');
  let text;
  try {
    text = await PROVIDERS[active.name].generateJson(buildSummaryPrompt(page), active.config);
  } finally {
    heartbeat.stop();
  }
  const result = parseSummary(text, page.paragraphs.length);
  await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// F5 질문 응답: 같은 페이지 글·같은 질문·같은 이전 대화면 캐시를 쓴다 (시연 리허설 대비).
async function askPage(page, question, history = []) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  if (!question?.trim()) return { error: '질문을 입력해주세요.' };
  if (!page?.paragraphs?.length) return { error: '이 페이지에서 읽을 글을 찾지 못했습니다.' };

  const prompt = buildQuestionPrompt(page, question.trim(), history);
  const cacheKey = await makeCacheKey('qa', active, [prompt]);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  const text = await PROVIDERS[active.name].generateJson(prompt, active.config);
  const result = parseAnswer(text, page.paragraphs.length);
  await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// F6 항목 설명(시험): 고른 항목 하나를 설명한다. 그림이 있으면 앞부분 조각을 함께 보낸다.
async function explainItem(item, progress) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  if (!item?.kind) return { error: '설명할 항목 정보가 없습니다.' };
  const provider = PROVIDERS[active.name];

  const cacheKey = await makeCacheKey('explain', active, [JSON.stringify(item)]);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  let tiles = [];
  let imageTruncated = false;
  if (item.imageUrl) {
    progress('그림을 불러오는 중');
    tiles = await loadImageTiles(item.imageUrl, provider.maxBase64Length);
    imageTruncated = tiles.length > MAX_EXPLAIN_TILES;
    tiles = tiles.slice(0, MAX_EXPLAIN_TILES);
  }

  progress(`${provider.label}로 설명을 만드는 중`);
  const prompt = buildExplainPrompt(item, { hasImage: tiles.length > 0, imageMissing: Boolean(item.imageUrl) && !tiles.length });
  const result = {
    ...parseExplanation(await provider.describe(prompt, tiles, active.config, progress)),
    imageRead: tiles.length > 0,
    imageMissing: Boolean(item.imageUrl) && !tiles.length,
    imageTruncated
  };
  // 그림을 못 읽은 결과는 일시적인 실패일 수 있어 저장하지 않는다(다시 누르면 다시 시도).
  if (!item.imageUrl || tiles.length) await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// A1 자동 보완: 이름 없는 항목의 짧은 이름. 같은 항목 정보·같은 모델이면 캐시를 쓴다.
async function labelItem(item) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  if (!item?.kind) return { error: '분석할 항목 정보가 없습니다.' };
  const provider = PROVIDERS[active.name];

  const cacheKey = await makeCacheKey('label', active, [JSON.stringify(item)]);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  let tiles = [];
  if (item.imageUrl) tiles = (await loadImageTiles(item.imageUrl, provider.maxBase64Length)).slice(0, 1);
  const prompt = buildLabelPrompt(item, { hasImage: tiles.length > 0 });
  const result = parseLabel(await provider.describe(prompt, tiles, active.config, () => {}));
  if (!item.imageUrl || tiles.length) await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// 그림을 못 불러오거나(SVG 등) 해석하지 못하면 글 정보만으로 설명한다.
async function loadImageTiles(url, maxBase64Length) {
  try {
    const { images } = await loadImages([url]);
    if (!images.length) return [];
    const bitmap = await createImageBitmap(images[0].blob);
    const tiles = await cutTiles(bitmap, { maxBase64Length });
    bitmap.close();
    return tiles;
  } catch {
    return [];
  }
}

async function makeCacheKey(kind, active, parts) {
  const source = [active.name, active.config.model, ...parts].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${kind}:${hex}`;
}
