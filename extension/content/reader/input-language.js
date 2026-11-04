// 한/영 키 안내: 한/영 키(macOS는 Caps Lock)를 누르면 바뀐 입력 언어("한글 입력", "영어 입력")를 읽는다.
// 웹페이지는 지금 입력 언어(IME 상태)를 직접 알 수 없으므로, 편집창에서 누른 글자로 지금 언어를 알아 두었다가
// 한/영 키를 누르면 반대 언어를 읽는다. 아직 모르면 다음 글자를 입력할 때 알려 준다.
// content script와 테스트가 같이 쓰므로 모듈 문법 없이 globalThis.__ongeul에 둔다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.inputLanguage) return;

  const NAMES = { ko: '한글 입력', en: '영어 입력' };
  const UNKNOWN = '한/영 전환. 글자를 하나 입력하면 지금 입력 언어를 알려 드립니다.';
  // 한글 자모·음절 (조합 중인 글자가 key로 오는 환경이 있음)
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

  const IS_MAC = /Mac/i.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');

  // 한/영 키인지. Windows 한국어 자판은 key "HangulMode"(오른쪽 Alt가 한/영 키인 자판 포함), 한/영 키 위치는 code "Lang1".
  // 한국어 입력기가 키를 먼저 처리하면 key가 "Process"로 오므로, 오른쪽 Alt 위치의 Process도 한/영 키로 본다.
  // macOS는 Caps Lock으로 한/영을 바꾸는 것이 기본이므로 Caps Lock도 한/영 키로 본다 (mac: 테스트에서 바꿔 쓴다)
  function isToggleKey(event, { mac = IS_MAC } = {}) {
    if (event.repeat) return false;
    if (mac && event.code === 'CapsLock') return true;
    return event.key === 'HangulMode' || event.code === 'Lang1' || (event.key === 'Process' && event.code === 'AltRight');
  }

  // macOS 크롬은 Caps Lock을 한 번 누를 때 keydown만, keyup만, 또는 둘 다 보낼 수 있다.
  // 한 번 누른 것을 한 번으로 세도록, keydown 뒤 이 시간 안에 온 keyup은 같은 누름으로 본다.
  const SAME_PRESS_MS = 1000;
  // 키보드에 따라 한/영 키 한 번에 keydown이 두 번 오기도 해서, 이 시간 안의 keydown은 한 번으로 센다
  const DOUBLE_DOWN_MS = 80;
  // "글자를 입력하면 알려 드립니다" 뒤 이 시간 안에 입력한 글자만 언어를 읽는다 (한참 뒤 읽던 내용을 끊지 않게)
  const WAIT_MS = 15_000;

  // 편집창에서 누른 키로 알아낸 입력 언어 (ko, en, 알 수 없으면 null)
  // 한글 입력 중에는 입력기가 키를 처리해 key가 "Process"(keyCode 229)로 오거나 조합 중(isComposing)이다.
  function languageOf(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return null;
    // Caps Lock이 켜져 있으면 한글 입력 상태에서도 영어 대문자가 입력되므로 판단하지 않는다
    if (event.getModifierState?.('CapsLock')) return null;
    if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || HANGUL.test(event.key ?? '')) return 'ko';
    if (/^[a-z]$/i.test(event.key ?? '')) return 'en';
    return null;
  }

  // 페이지마다 하나. language: 알고 있는 입력 언어(ko, en) 또는 null
  function createTracker(language = null) {
    // 한/영 키 뒤 언어를 몰라 다음 글자를 기다리기 시작한 때 (기다리지 않으면 null)
    let waitingSince = null;
    // 한/영 키 뒤에 읽어 준 언어. 다음 글자로 실제 언어를 확인해, 다르면 바로잡아 읽는다
    let announced = null;
    let lastDownAt = -Infinity;
    return {
      get language() {
        return language;
      },
      set(next) {
        if (next === 'ko' || next === 'en') language = next;
      },
      // 온글을 끄면 그사이 바꾼 한/영은 알 수 없으므로 모르는 상태로 돌아간다
      reset() {
        language = null;
        waitingSince = null;
        announced = null;
      },
      // 한/영 키 이벤트를 받았을 때 읽을 문장. 같은 누름의 keyup이나 겹쳐 온 keydown이면 null (now: 테스트에서 바꿔 쓴다)
      press(event, now = performance.now()) {
        if (event.type === 'keyup') {
          if (now - lastDownAt < SAME_PRESS_MS) return null;
        } else {
          if (now - lastDownAt < DOUBLE_DOWN_MS) return null;
          lastDownAt = now;
        }
        return this.toggle(now);
      },
      // 한/영 키를 눌렀을 때 읽을 문장
      toggle(now = performance.now()) {
        if (!language) {
          waitingSince = now;
          announced = null;
          return UNKNOWN;
        }
        language = language === 'ko' ? 'en' : 'ko';
        announced = language;
        return NAMES[language];
      },
      // 편집창에서 누른 키로 언어를 알아 둔다. 읽을 문장(없으면 null)을 돌려준다:
      // 한/영 키 뒤 언어를 몰라 기다리던 중이면 알아낸 언어를, 방금 읽어 준 언어와 실제 언어가 다르면 실제 언어를.
      learn(event, now = performance.now()) {
        const found = languageOf(event);
        if (!found) return null;
        language = found;
        const wrong = announced && announced !== found;
        const waiting = waitingSince !== null && now - waitingSince < WAIT_MS;
        announced = null;
        waitingSince = null;
        return waiting || wrong ? NAMES[found] : null;
      }
    };
  }

  ns.inputLanguage = { NAMES, UNKNOWN, isToggleKey, languageOf, createTracker };
})();
