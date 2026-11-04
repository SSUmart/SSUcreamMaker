// 크롬 기본 새 탭은 chrome:// 화면이라 확장 프로그램이 들어갈 수 없어 온글이 읽지 못하고 키도 받지 못한다.
// 설정(reader.newTab)이 google이면 서비스 워커가 새 탭을 google.com으로 옮겨 온글이 읽을 수 있게 한다.
export const NEW_TAB_HOME = 'https://www.google.com/';

// 크롬 기본 새 탭 주소: chrome://newtab, chrome://new-tab-page(구글 새 탭), chrome-search://local-ntp(다른 검색엔진)
export function isNewTabUrl(url = '') {
  return /^chrome(-search)?:\/\/(newtab|new-tab-page|local-ntp)(\/|$)/i.test(url);
}

// 이 탭을 google.com으로 옮겨야 하는지
export function shouldRedirectNewTab(url, settings) {
  return settings?.reader?.newTab !== 'chrome' && isNewTabUrl(url);
}
