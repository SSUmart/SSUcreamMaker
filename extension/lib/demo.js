// 발표 시연용: 접속 주소가 테스트 서버일 때 저장 결과가 있는 페이지는 오래 걸리는 AI 작업 대신 미리 저장한 결과를 바로 돌려준다.
// 결과는 확장 안에 들어 있어 웹페이지가 내용을 바꿀 수 없다. 로컬 주소(평가·E2E)와 다른 사이트에서는 항상 실제 AI를 쓴다.
import { DEMO_DATA } from './demo-data.js';

export const DEMO_HOSTS = ['ssu.jaymong.me'];
const DEMO_PATHS = ['/mall/', '/shop/'];

const parseUrl = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

// 저장 결과를 찾는 열쇠: 테스트 서버의 /mall/, /shop/ 페이지가 아니면 null
export function demoPageKey(pageUrl) {
  const url = parseUrl(pageUrl);
  if (!url || !DEMO_HOSTS.includes(url.hostname) || !DEMO_PATHS.some((p) => url.pathname.startsWith(p))) return null;
  const pathname = url.pathname.replace(/\/index\.html$/, '/');
  const id = url.searchParams.get('id');
  return id ? `${pathname}?id=${id}` : pathname;
}

const recordFor = (pageUrl, data) => data.pages[demoPageKey(pageUrl)] ?? null;

// 저장 결과가 없거나 상세 이미지가 지금 페이지에 보이지 않으면(탭이 닫혀 있는 등) null을 돌려줘 원래 길로 간다.
export function demoDetail(pageUrl, urls, data = DEMO_DATA) {
  const record = recordFor(pageUrl, data)?.detail;
  if (!record) return null;
  const byPath = new Map(urls.map((url) => [parseUrl(url)?.pathname, url]));
  const firstUrl = record.images.map((path) => byPath.get(path)).find(Boolean);
  if (!firstUrl) return null;
  return { sections: record.sections, imageCount: record.images.length, firstUrl, truncated: false, failedCount: 0 };
}

// 근거 문단은 글자로 저장해 두고 지금 페이지의 문단 번호로 바꾼다 (상세 이미지 상자가 먼저 열려 있으면 번호가 달라지므로).
export function demoSummary(pageUrl, page, data = DEMO_DATA) {
  const record = recordFor(pageUrl, data)?.summary;
  if (!record) return null;
  const paragraphs = page?.paragraphs ?? [];
  return {
    overview: record.overview,
    items: record.items.map(({ text, sourceTexts }) => ({
      text,
      sources: sourceTexts.map((source) => paragraphs.indexOf(source) + 1).filter(Boolean)
    }))
  };
}
