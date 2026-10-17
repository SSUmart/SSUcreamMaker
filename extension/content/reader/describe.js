// AI에 보낼 항목 정보 모으기 (A1 자동 보완, 현재 항목 설명). 항목 설명 모드(content/explain.js)와 같은 규칙:
// 입력창·편집 영역에 쓴 글은 보내지 않고, 링크는 쿼리 없이 주소만, 그림은 그림 자체이거나 글자 없이 그림만 든 버튼·링크일 때만.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.describe) return;

  const EDITABLE =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';
  const NON_TEXT = 'script, style, noscript, template';
  const OWN = '[data-ongeul-ui], #ssucream-status';
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'ec-data-src'];
  const MAX_TEXT = 500;
  const MAX_CONTEXT = 400;

  const clean = (text, max = MAX_TEXT) => {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
  };

  // 요소 안의 글자를 모으되 입력 영역과 스크립트 등은 뺀다
  function safeText(root, max = MAX_TEXT) {
    if (root.matches(EDITABLE) || root.isContentEditable) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    let length = 0;
    for (let node = walker.nextNode(); node && length <= max; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.data.trim()) continue;
      if (parent.closest(EDITABLE) || parent.isContentEditable || parent.closest(NON_TEXT) || parent.closest(OWN)) continue;
      if (!parent.checkVisibility()) continue;
      parts.push(node.data);
      length += node.data.length;
    }
    return clean(parts.join(' '), max);
  }

  // 링크는 쿼리 없이 주소만 보낸다 (로그인 토큰 등이 붙어 있을 수 있음)
  function linkOf(el) {
    if (!el.matches('a[href]')) return '';
    try {
      const url = new URL(el.href);
      if (!/^https?:$/.test(url.protocol)) return `${url.protocol.slice(0, -1)} 주소`;
      return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
    } catch {
      return '';
    }
  }

  // 항목 앞에 나온 마지막 제목
  function headingOf(el) {
    let found = null;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (heading.closest(OWN) || heading === el || heading.contains(el)) continue;
      if (!(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      found = heading;
    }
    return clean(found?.textContent, 100);
  }

  // 항목 자신의 글자와 다른 글이 나올 때까지 바깥 요소로 올라가며 주변 글을 찾는다
  function contextOf(el, ownText) {
    let parent = el.parentElement;
    for (let i = 0; parent && parent !== document.body && i < 4; i++, parent = parent.parentElement) {
      const text = safeText(parent, MAX_CONTEXT);
      if (text && text !== ownText) return text;
    }
    return '';
  }

  function imageUrlOf(img) {
    for (const attr of LAZY_ATTRS) {
      const value = img.getAttribute(attr);
      if (value && !value.startsWith('data:')) return new URL(value, document.baseURI).href;
    }
    return img.currentSrc || img.src || '';
  }

  function imageOf(el, ownText) {
    if (el.matches('img')) return imageUrlOf(el);
    const imgs = el.querySelectorAll('img');
    return imgs.length === 1 && !ownText ? imageUrlOf(imgs[0]) : '';
  }

  // 클래스·아이디·주소에 든 단서 (예: btn-cart, icon-trash). AI 근거와 파괴적 동작 교차 검증에 쓴다.
  function hintsOf(el) {
    const parts = [el.id, el.getAttribute('class'), el.getAttribute('name'), el.getAttribute('data-action')];
    el.querySelectorAll('use, i, span[class], svg[class], img').forEach((child) => {
      parts.push(child.getAttribute('href') || child.getAttribute('xlink:href'), child.getAttribute('class'), child.getAttribute('src'));
    });
    if (el.matches('a[href]')) parts.push(linkOf(el));
    const form = el.closest('form');
    if (form?.getAttribute('action')) parts.push(`form:${form.getAttribute('action').split('?')[0]}`);
    return clean(parts.filter(Boolean).join(' '), 300);
  }

  function describeElement(el, item) {
    const text = safeText(el);
    const roleName = item ? ns.model.ROLE_NAMES[item.role] || '페이지 요소' : '페이지 요소';
    const states = item?.states?.join(', ') ?? '';
    return {
      pageTitle: clean(document.title, 200),
      kind: roleName,
      name: item?.name ?? '',
      text,
      state: states,
      link: linkOf(el),
      heading: headingOf(el),
      context: [contextOf(el, text), hintsOf(el) && `요소 단서: ${hintsOf(el)}`].filter(Boolean).join(' / '),
      imageUrl: imageOf(el, text)
    };
  }

  ns.describe = { describeElement, hintsOf };
})();
