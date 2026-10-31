// F4 요약, F5 질문 응답이 같이 쓰는 도구: 본문 문단 수집, 근거 위치로 이동, 상태 안내.
// summary.js, qa.js보다 먼저 주입된다. 여러 번 주입돼도 한 번만 정의한다.
(() => {
  if (window.__ssucreamPage) return;

  // 화면에는 보이지 않고 스크린리더만 읽는 스타일 (detail.js와 같음)
  const SR_ONLY =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
    'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
  // 이 요소 하나가 문단 하나가 된다. 표는 행 단위로 묶는다.
  const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,caption,figcaption,blockquote,pre,tr,summary,legend,label';
  const SKIP =
    'script,style,noscript,template,svg,canvas,iframe,textarea,select,option,nav,aside,' +
    // 사용자가 글을 쓰는 편집 영역(웹메일 작성창, 댓글·문서 편집기)은 AI로 보내지 않는다 (입력창 값과 같은 이유)
    '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],' +
    '[aria-hidden="true"],#ssucream-summary,#ssucream-qa,#ssucream-status,#ssucream-explain,#ssucream-explain-bar,#ssucream-detail button';
  const MAX_CHARS = 30_000;
  const MAX_PARAGRAPH_CHARS = 600;
  const MIN_MAIN_CHARS = 200;

  // 사이트 머리·꼬리말은 빼되, 본문(article) 안의 header·footer는 남긴다.
  function skipped(el) {
    if (el.closest(SKIP) || el.isContentEditable) return true;
    const edge = el.closest('header, footer');
    return Boolean(edge && !edge.closest('main, article, [role="main"]'));
  }

  // 닫힌 탭 패널은 숨겨져 있어도 수집한다 (리뷰, 배송 안내 탭 등). 근거로 이동할 때 탭을 연다.
  function visible(el) {
    if (el.checkVisibility()) return true;
    const panel = el.closest('[role="tabpanel"]');
    return Boolean(panel?.parentElement?.checkVisibility());
  }

  // 스크린리더 전용 글자(sr-only)는 화면 배치상 블록이지만 앞뒤 글과 한 문장으로 읽힌다.
  function srOnly(el, style) {
    return style.position === 'absolute' && el.offsetWidth <= 1 && el.offsetHeight <= 1;
  }

  // 정의 목록의 값(dd)은 바로 앞 이름(dt)과 한 문단으로 묶는다. 예: "배송비 3,000원"
  function termOf(dd) {
    let prev = dd.previousElementSibling;
    while (prev && !prev.matches('dt')) prev = prev.previousElementSibling;
    return prev ?? dd;
  }

  // 글자가 속한 문단 요소: 가장 가까운 블록 요소 (표 칸은 그 행)
  function unitOf(textNode, root) {
    let el = textNode.parentElement;
    while (el && el !== root) {
      if (el.matches('td, th')) return el.closest('tr') ?? el;
      if (el.matches('dd')) return termOf(el);
      if (el.matches(BLOCKS)) return el;
      const style = getComputedStyle(el);
      if (style.display !== 'inline' && style.display !== 'contents' && !srOnly(el, style)) return el;
      el = el.parentElement;
    }
    return root;
  }

  function pickRoot() {
    const main = document.querySelector('main, [role="main"]');
    return main && main.textContent.trim().length >= MIN_MAIN_CHARS ? main : document.body;
  }

  function collectFrom(root, units) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const checked = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      if (!checked.has(parent)) checked.set(parent, !skipped(parent) && visible(parent));
      if (!checked.get(parent)) continue;
      const unit = unitOf(node, root);
      // 표 칸, 정의 목록의 이름과 값, sr-only 글자는 앞뒤를 띄워 붙지 않게 한다.
      const piece = parent.closest('td, th, dt, dd') || parent !== unit ? ` ${node.data} ` : node.data;
      units.set(unit, (units.get(unit) ?? '') + piece);
    }
  }

  // 페이지 본문을 문단 목록으로 모은다. elements[i]는 paragraphs[i]의 위치(근거 이동용).
  function collect() {
    const root = pickRoot();
    const units = new Map();
    collectFrom(root, units);
    // 상세 이미지 추출 결과(F2)가 본문 밖에 들어갔다면 따로 넣는다.
    const detail = document.getElementById('ssucream-detail');
    if (detail && !root.contains(detail)) collectFrom(detail, units);

    const paragraphs = [];
    const elements = [];
    let total = 0;
    let truncated = false;
    for (const [element, raw] of units) {
      let text = raw.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text === paragraphs.at(-1)) continue;
      if (text.length > MAX_PARAGRAPH_CHARS) text = `${text.slice(0, MAX_PARAGRAPH_CHARS)}…`;
      if (total + text.length > MAX_CHARS) {
        truncated = true;
        break;
      }
      total += text.length;
      paragraphs.push(text);
      elements.push(element);
    }
    return { payload: { title: document.title, url: location.href, paragraphs, truncated }, elements };
  }

  // 상세 이미지 읽기(F2)를 아직 실행하지 않았고, 대체 텍스트 없는 긴 이미지가 있는지
  function hasUnreadDetailImages() {
    if (document.getElementById('ssucream-detail')) return false;
    return [...document.images].some((img) => {
      if (img.closest('header, nav, footer') || img.getAttribute('alt')) return false;
      const width = Number(img.getAttribute('width')) || img.naturalWidth || img.width;
      const height = Number(img.getAttribute('height')) || img.naturalHeight || img.height;
      return width >= 400 && height >= width * 1.2;
    });
  }

  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

  // 근거 문단으로 포커스를 옮긴다. 닫힌 탭 안에 있으면 그 탭을 먼저 연다.
  function focusSource(el) {
    if (!el?.isConnected) return false;
    const panel = el.closest('[role="tabpanel"]');
    if (panel && !panel.checkVisibility()) {
      const tab =
        document.getElementById(panel.getAttribute('aria-labelledby')) ??
        (panel.id && document.querySelector(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"]`));
      tab?.click();
    }
    const details = el.closest('details:not([open])');
    if (details) details.open = true;
    // 닫거나 접어 둔 상세 이미지 결과 상자 안이면 먼저 펼친다
    el.closest('#ssucream-detail')?.ssucreamShow?.();
    if (!el.checkVisibility()) return false;

    if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    // 화면을 보는 사람(저시력 사용자, 시연 청중)을 위해 잠시 강조한다.
    const previous = el.style.outline;
    el.style.outline = '3px solid #d97706';
    setTimeout(() => (el.style.outline = previous), 3000);
    return true;
  }

  function statusRegion() {
    let region = document.getElementById('ssucream-status');
    if (!region) {
      region = document.createElement('div');
      region.id = 'ssucream-status';
      region.setAttribute('role', 'status');
      region.style.cssText = SR_ONLY;
      document.body.append(region);
    }
    return region;
  }

  // 진행 상황 안내용. 결과와 오류는 이것만 쓰지 않고 페이지 안에 남긴다(점자 우선).
  let announceTimer = null;
  function announce(text) {
    const region = statusRegion();
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (region.textContent = text), 100);
  }

  // 끝난 진행 안내를 지운다 (결과를 읽기 시작했는데 지난 "…하는 중" 안내가 뒤늦게 읽히지 않도록)
  function clearStatus() {
    clearTimeout(announceTimer);
    const region = document.getElementById('ssucream-status');
    if (region) region.textContent = '';
  }

  function el(tag, text, style) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }

  // 페이지 디자인과 섞이지 않게 요약 상자·대화상자에 쓰는 공통 스타일
  const STYLE = {
    box:
      'display:block;box-sizing:border-box;margin:16px auto;padding:16px 20px;max-width:960px;' +
      'background:#fff;color:#111;border:3px solid #1d4ed8;border-radius:8px;' +
      'font:16px/1.6 system-ui,sans-serif;text-align:left;position:relative;z-index:2147483000;',
    heading: 'margin:0 0 8px;font-size:20px;font-weight:700;color:#111;',
    text: 'margin:0 0 8px;color:#111;',
    note: 'margin:0 0 8px;color:#374151;font-size:14px;',
    list: 'margin:0 0 12px;padding-left:24px;color:#111;',
    button:
      'margin:4px 8px 0 0;padding:4px 12px;font:14px/1.6 system-ui,sans-serif;color:#1d4ed8;' +
      'background:#fff;border:1px solid #1d4ed8;border-radius:4px;cursor:pointer;'
  };

  // 대화상자: display를 지정하면 닫힌 대화상자가 숨겨지지 않으므로 상자 스타일에서 빼고,
  // 상자 스타일의 position:relative가 대화상자 기본 배치(화면 가운데 고정)를 덮지 않게 fixed로 되돌린다.
  STYLE.dialog =
    STYLE.box.replace('display:block;', '').replace('margin:16px auto;', 'margin:auto;') +
    'position:fixed;inset:0;height:fit-content;width:min(640px,92vw);max-height:80vh;overflow:auto;';

  // 요약·질문이 쓰는 화면 가운데 대화상자(<dialog>). 페이지 레이아웃을 건드리지 않는다.
  // 닫으면 크롬이 열기 전 초점 요소로 초점을 돌려준다. 온글이 그 뒤 다른 곳(글 문단 등)을 읽던 중이었으면
  // 크롬이 돌려준 초점이 아니라 그 읽던 위치로 되돌린다. Esc로도 닫힌다(<dialog> 기본 동작).
  // 근거 위치로 가려고 닫을 때는 closeTo를 써서 읽던 위치로 되돌리지 않는다.
  function createDialog(id, titleText) {
    const dialog = el('dialog', null, STYLE.dialog);
    dialog.id = id;
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    const title = el('h2', titleText, STYLE.heading);
    title.id = `${id}-title`;
    title.tabIndex = -1;
    // 대화상자가 열려 있으면 바깥(페이지의 안내 영역)은 다른 스크린리더에게 보이지 않으므로(inert),
    // 대화상자 안에 따로 안내 영역을 둔다
    const status = el('div');
    status.setAttribute('role', 'status');
    status.style.cssText = SR_ONLY;
    dialog.append(title, status);
    document.body.append(dialog);
    let statusTimer = null;
    function announceInside(text) {
      status.textContent = '';
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (status.textContent = text), 100);
    }

    let readerSpot = null;
    dialog.addEventListener('close', () => {
      const reader = globalThis.__ongeul?.reader;
      const active = document.activeElement;
      const restored = active && active !== document.body && (active === readerSpot || readerSpot?.contains(active));
      if (reader?.enabled && readerSpot?.isConnected && !restored) reader.moveToElement(readerSpot);
      readerSpot = null;
    });

    // 원문·근거 위치로 이동하며 닫을 때. 다른 기능(상세 이미지 결과 읽기)이 사용자가 고른 위치를 덮지 않도록 표시를 남긴다
    function closeTo() {
      readerSpot = null;
      dialog.dataset.closedToSource = 'true';
      dialog.close();
      // close 이벤트 처리가 모두 끝난 뒤 지운다
      setTimeout(() => delete dialog.dataset.closedToSource, 0);
    }

    function open() {
      if (dialog.open) return;
      const reader = globalThis.__ongeul?.reader;
      readerSpot = reader?.enabled ? reader.items[reader.index]?.el ?? null : null;
      dialog.showModal();
    }
    // 다른 기능(상세 이미지)이 대화상자가 열려 있을 때 안내할 수 있도록 대화상자에 붙여 둔다
    dialog.ssucreamAnnounce = announceInside;
    return { dialog, title, open, closeTo, announce: announceInside };
  }

  // 사용자가 듣는 오류 문장. 서비스 워커와 연결이 끊긴 경우 등 브라우저의 영어 오류, 오류 코드·JSON이 섞인 원문은 한국어 안내로 바꾼다.
  // RAW_ERROR는 lib/errors.js와 같게 둔다 (content script는 모듈을 불러올 수 없음. 같은지는 테스트가 확인)
  const RAW_ERROR = /[{}<>[\]]|https?:|\(\s*(오류\s*)?[1-5]\d\d\s*\)|오류\s*[1-5]\d\d|\b(error|status|code|exception|unavailable|invalid)\b/i;
  function friendlyError(error) {
    const text = error?.message ?? String(error ?? '');
    const korean = /[가-힣]/.test(text);
    if (korean && !RAW_ERROR.test(text)) return text;
    console.warn('온글 기능 오류', error);
    // 한국어 안내에 원문이 섞인 경우는 연결 문제가 아니므로 일반 안내로 (lib/errors.js의 GENERIC_ERROR와 같은 문장)
    if (korean) return '처리하는 중 알 수 없는 오류가 났습니다. 잠시 뒤 다시 시도하세요.';
    return '온글과 연결이 끊겼습니다. 페이지를 새로고침(F5)한 뒤 다시 시도하세요.';
  }

  window.__ssucreamPage = { collect, focusSource, hasUnreadDetailImages, announce, clearStatus, el, createDialog, friendlyError, STYLE };
})();
