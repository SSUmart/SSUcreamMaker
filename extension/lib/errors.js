// 사용자가 듣는(점자로 읽는) 오류 문장을 고른다.
// 온글이 만든 한국어 안내는 그대로 쓰고, 서버·브라우저 오류 원문(영어, 오류 코드, JSON, 주소)이 섞인 문장은 일반 안내로 바꾼다.
// 원문은 개발자가 볼 수 있게 콘솔에만 남긴다.
// content/page-text.js의 friendlyError도 같은 기준을 쓴다(content script는 이 모듈을 불러올 수 없어 RAW_ERROR를 그대로 옮겨 둠).

// 원문 흔적: 중괄호·꺾쇠·대괄호(JSON, HTML), 주소, HTTP 상태 코드("(503)", "(오류 503)", "오류 503"), 영어 오류 낱말
export const RAW_ERROR = /[{}<>[\]]|https?:|\(\s*(오류\s*)?[1-5]\d\d\s*\)|오류\s*[1-5]\d\d|\b(error|status|code|exception|unavailable|invalid)\b/i;

export const GENERIC_ERROR = '처리하는 중 알 수 없는 오류가 났습니다. 잠시 뒤 다시 시도하세요.';

export function userMessage(error, fallback = GENERIC_ERROR) {
  const text = error?.message ?? String(error ?? '');
  if (/[가-힣]/.test(text) && !RAW_ERROR.test(text)) return text;
  console.warn('사용자에게 보이지 않게 바꾼 오류', error);
  return fallback;
}
