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
    '[aria-hidden="true"],#ssucream-summary,#ssucream-qa,#ssucream-status,#ssucream-explain,#ssucream-explain-bar';
  const MAX_CHARS = 30_000;
  const MAX_PARAGRAPH_CHARS = 600;
  const MIN_MAIN_CHARS = 200;

  // 사이트 머리·꼬리말은 빼되, 본문(article) 안의 header·footer는 남긴다.
  function skipped(el) {
    if (el.closest(SKIP)) return true;
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
    if (!el.checkVisibility() && !el.closest('#ssucream-detail')) return false;

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
  function announce(text) {
    const region = statusRegion();
    region.textContent = '';
    setTimeout(() => (region.textContent = text), 100);
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

  window.__ssucreamPage = { collect, focusSource, hasUnreadDetailImages, announce, el, STYLE };
})();
