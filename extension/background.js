import { activeProvider, loadSettings } from './lib/settings.js';
import { pickDetailImages } from './lib/detect.js';
import { cutTiles } from './lib/tiles.js';
import { PROVIDERS } from './lib/providers.js';
import { parseSections } from './lib/structure.js';

// 한 번에 AI로 보내는 조각 수 상한. 사용자 API 요금이 과하게 나오지 않도록 한다.
const MAX_TILES = 40;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(runOnTab);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'read-detail') runOnTab(tab);
});

async function runOnTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/detail.js'] });
  } catch (error) {
    // chrome:// 같은 페이지에는 주입할 수 없다.
    console.warn('content script 주입 실패', error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'extract-detail' || !sender.tab?.id) return;
  const progress = (text) =>
    chrome.tabs.sendMessage(sender.tab.id, { type: 'progress', text }).catch(() => {});
  extractDetail(message.urls, progress).then(sendResponse, (error) =>
    sendResponse({ error: error.message })
  );
  return true;
});

async function extractDetail(urls, progress) {
  const active = activeProvider(await loadSettings());
  if (active.error) return { error: active.error };
  const provider = PROVIDERS[active.name];

  const cacheKey = await makeCacheKey(active, urls);
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

async function makeCacheKey(active, urls) {
  const source = [active.name, active.config.model, ...urls].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `detail:${hex}`;
}
