import { activeProvider, loadSettings } from './lib/settings.js';
import { pickDetailImages } from './lib/detect.js';
import { cutTiles } from './lib/tiles.js';
import { PROVIDERS } from './lib/providers.js';
import { parseSections } from './lib/structure.js';
import { buildQuestionPrompt, buildSummaryPrompt, parseAnswer, parseSummary } from './lib/answer.js';
import { MAX_EXPLAIN_TILES, buildExplainPrompt, parseExplanation } from './lib/explain.js';

// 한 번에 AI로 보내는 조각 수 상한. 사용자 API 요금이 과하게 나오지 않도록 한다.
const MAX_TILES = 40;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

// 단축키별로 페이지에 넣을 content script. page-text.js는 요약·질문 응답이 같이 쓴다.
const COMMAND_FILES = {
  'read-detail': ['content/detail.js'],
  'summarize-page': ['content/page-text.js', 'content/summary.js'],
  'ask-page': ['content/page-text.js', 'content/qa.js'],
  'explain-mode': ['content/page-text.js', 'content/explain.js']
};

chrome.action.onClicked.addListener((tab) => runOnTab(tab, 'read-detail'));
chrome.commands.onCommand.addListener((command, tab) => {
  if (COMMAND_FILES[command]) runOnTab(tab, command);
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

const HANDLERS = {
  'extract-detail': (message, progress) => extractDetail(message.urls, progress),
  'summarize-page': (message) => summarizePage(message.page),
  'ask-page': (message) => askPage(message.page, message.question, message.history),
  'explain-item': (message, progress) => explainItem(message.item, progress)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler || !sender.tab?.id) return;
  const progress = (text) =>
    chrome.tabs.sendMessage(sender.tab.id, { type: 'progress', text }).catch(() => {});
  handler(message, progress).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

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

  progress(`상세 이미지 ${picked.length}개를 ${provider.label}로 읽는 중`);
  const sections = parseSections(await provider.extract(tiles, active.config, progress));
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
async function summarizePage(page) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  if (!page?.paragraphs?.length) return { error: '요약할 글을 찾지 못했습니다.' };

  const cacheKey = await makeCacheKey('summary', active, [page.title, ...page.paragraphs]);
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;

  const text = await PROVIDERS[active.name].generateJson(buildSummaryPrompt(page), active.config);
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
  const prompt = buildExplainPrompt(item, { hasImage: tiles.length > 0 });
  const result = {
    ...parseExplanation(await provider.describe(prompt, tiles, active.config, progress)),
    imageRead: tiles.length > 0,
    imageTruncated
  };
  // 그림을 못 읽은 결과는 일시적인 실패일 수 있어 저장하지 않는다(다시 누르면 다시 시도).
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
