// F6 항목 설명(시험): 단축키로 주입되며 누를 때마다 항목 설명 모드를 켜고 끈다.
// 모드가 켜진 동안 페이지 항목을 클릭하면(스크린리더에서 Enter도 클릭) 그 항목을 AI가 설명하는 대화상자를 연다.
// 클릭은 가로채므로 링크 이동이나 버튼 동작은 일어나지 않는다.
(() => {
  if (window.__ssucreamExplain) {
    window.__ssucreamExplain();
    return;
  }
  const { announce, el, friendlyError, STYLE } = window.__ssucreamPage;

  const OWN = '#ssucream-explain, #ssucream-explain-bar';
  // 가장 가까운 조작 요소를 고르고, 없으면 글·그림 단위 요소를 고른다.
  const INTERACTIVE =
    'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"],' +
    ' [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], [onclick],' +
    ' [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';
  // 사용자가 입력하는 곳. 안의 글자는 개인정보일 수 있어 항목 글자로도, 주변 글로도 보내지 않는다.
  const EDITABLE =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]),' +
    ' [role="textbox"], [role="searchbox"], [role="combobox"]';
  const NON_TEXT = 'script, style, noscript, template';
  const BLOCK = 'img, h1, h2, h3, h4, h5, h6, p, li, dt, dd, td, th, caption, figcaption, blockquote, figure';
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'ec-data-src'];
  const MAX_TEXT = 500;
  const MAX_CONTEXT = 400;

  const ROLE_NAMES = {
    button: '버튼', link: '링크', tab: '탭', checkbox: '체크박스', radio: '라디오 버튼', switch: '스위치',
    menuitem: '메뉴 항목', option: '선택 항목', img: '이미지', heading: '제목',
    textbox: '입력창', searchbox: '검색창', combobox: '콤보 상자'
  };
  const TAG_NAMES = {
    a: '링크', button: '버튼', summary: '펼치기 버튼', select: '콤보 상자', textarea: '여러 줄 입력창',
    img: '이미지', p: '문단', li: '목록 항목', dt: '정의 목록 항목', dd: '정의 목록 항목', td: '표 칸',
    th: '표 제목 칸', caption: '표 제목', figcaption: '그림 설명', figure: '그림', blockquote: '인용문', label: '레이블'
  };
  const INPUT_NAMES = {
    checkbox: '체크박스', radio: '라디오 버튼', search: '검색창', number: '숫자 입력창', email: '이메일 입력창',
    password: '비밀번호 입력창', submit: '버튼', button: '버튼', image: '이미지 버튼', range: '슬라이더'
  };

  let on = false;
  let busy = false;
  let hovered = null;
  let hoveredOutline = '';
  let returnTo = null;

  const clean = (text, max = MAX_TEXT) => {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
  };

  // --- 항목 정보 모으기
  function pickTarget(node) {
    return node.closest(INTERACTIVE) ?? node.closest(BLOCK) ?? node;
  }

  function kindOf(target) {
    const role = target.getAttribute('role');
    if (ROLE_NAMES[role]) return ROLE_NAMES[role];
    const tag = target.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `제목 ${tag[1]}단계`;
    if (tag === 'input') return INPUT_NAMES[target.type] ?? '입력창';
    if (TAG_NAMES[tag]) return TAG_NAMES[tag];
    if (target.isContentEditable) return '입력창';
    return target.hasAttribute('onclick') ? '클릭할 수 있는 요소' : '페이지 요소';
  }

  function nameOf(target) {
    const labelledby = target.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (clean(text)) return clean(text);
    }
    const direct =
      target.getAttribute('aria-label') ||
      target.getAttribute('alt') ||
      (target.labels?.[0] && target.labels[0].textContent) ||
      target.getAttribute('title') ||
      target.getAttribute('placeholder');
    if (clean(direct)) return clean(direct);
    // 입력 값 중 버튼 글자만은 화면에 보이는 이름이다 (<input type="submit" value="구매">).
    if (target.matches('input[type="submit"], input[type="button"], input[type="reset"]')) return clean(target.value);
    return clean(target.querySelector?.('img[alt]')?.getAttribute('alt'));
  }

  // 입력창에 적힌 값은 보내지 않는다(개인정보). 체크 여부 같은 상태만 보낸다.
  function stateOf(target) {
    const states = [];
    const aria = (name) => target.getAttribute(`aria-${name}`);
    if (aria('pressed')) states.push(aria('pressed') === 'true' ? '눌림' : '안 눌림');
    if (aria('expanded')) states.push(aria('expanded') === 'true' ? '펼쳐짐' : '접힘');
    if (aria('selected') === 'true') states.push('선택됨');
    if (aria('current') && aria('current') !== 'false') states.push('현재 위치');
    if (target.matches('input[type="checkbox"], input[type="radio"]')) states.push(target.checked ? '체크됨' : '체크 안 됨');
    else if (aria('checked')) states.push(aria('checked') === 'true' ? '체크됨' : '체크 안 됨');
    if (target.disabled || aria('disabled') === 'true') states.push('사용할 수 없음');
    if (target.required || aria('required') === 'true') states.push('필수');
    return states.join(', ');
  }

  // 링크는 쿼리 없이 주소만 보낸다(로그인 토큰 등이 붙어 있을 수 있음).
  function linkOf(target) {
    if (!target.matches('a[href]')) return '';
    try {
      const url = new URL(target.href);
      // mailto:, tel:, javascript: 등은 주소 대신 종류만 보낸다.
      if (!/^https?:$/.test(url.protocol)) return `${url.protocol.slice(0, -1)} 주소`;
      return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
    } catch {
      return '';
    }
  }

  // 항목 앞에 나온 마지막 제목
  function headingOf(target) {
    let found = null;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (heading.closest(OWN) || heading === target || heading.contains(target)) continue;
      if (!(heading.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      found = heading;
    }
    return clean(found?.textContent, 100);
  }

  // 요소 안의 글자를 모으되 입력 영역과 스크립트 등은 뺀다.
  function safeText(root, max = MAX_TEXT) {
    if (root.matches(EDITABLE) || root.isContentEditable) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    const allowed = new Map();
    let length = 0;
    for (let node = walker.nextNode(); node && length <= max; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.data.trim()) continue;
      if (!allowed.has(parent)) {
        allowed.set(
          parent,
          !parent.closest(EDITABLE) && !parent.isContentEditable && !parent.closest(NON_TEXT) && parent.checkVisibility()
        );
      }
      if (!allowed.get(parent)) continue;
      parts.push(node.data);
      length += node.data.length;
    }
    return clean(parts.join(' '), max);
  }

  // 항목 자신의 글자와 다른 글이 나올 때까지 바깥 요소로 올라가며 주변 글을 찾는다.
  function contextOf(target, ownText) {
    let parent = target.parentElement;
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

  // 그림 자체이거나, 글자 없이 그림만 든 버튼·링크면 그림을 함께 보낸다.
  function imageOf(target, ownText) {
    if (target.matches('img')) return imageUrlOf(target);
    const imgs = target.querySelectorAll('img');
    return imgs.length === 1 && !ownText ? imageUrlOf(imgs[0]) : '';
  }

  function describe(target) {
    const text = safeText(target);
    return {
      pageTitle: clean(document.title, 200),
      kind: kindOf(target),
      // 조작 요소는 이름이 따로 없으면 보이는 글자가 이름이다 (예: "장바구니 담기" 버튼).
      name: nameOf(target) || (target.matches(INTERACTIVE) ? clean(text, 100) : ''),
      text,
      state: stateOf(target),
      link: linkOf(target),
      heading: headingOf(target),
      context: contextOf(target, text),
      imageUrl: imageOf(target, text)
    };
  }

  // --- 대화상자
  const dialog = el(
    'dialog',
    null,
    // 공통 상자 스타일의 position:relative가 대화상자 기본 배치(화면 가운데 고정)를 덮지 않게 fixed로 되돌린다.
    STYLE.box.replace('display:block;', '').replace('margin:16px auto;', 'margin:auto;') +
      'position:fixed;inset:0;height:fit-content;width:min(560px,92vw);max-height:80vh;overflow:auto;'
  );
  dialog.id = 'ssucream-explain';
  dialog.setAttribute('aria-labelledby', 'ssucream-explain-title');
  const title = el('h2', '항목 설명', STYLE.heading);
  title.id = 'ssucream-explain-title';
  const picked = el('p', null, 'margin:0 0 8px;color:#111;font-weight:700;');
  const result = el('p', null, STYLE.text);
  result.tabIndex = -1;
  const note = el('p', null, STYLE.note);
  const close = el('button', '닫기', STYLE.button);
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  dialog.append(title, picked, result, note, close);

  // 닫으면 고른 항목으로 돌아간다.
  dialog.addEventListener('close', () => {
    if (!returnTo?.isConnected) return;
    if (!returnTo.matches('a[href], button, input, select, textarea, [tabindex]')) returnTo.tabIndex = -1;
    returnTo.focus({ preventScroll: true });
  });

  // 모드가 켜져 있음을 화면에도 보여 주고, 마우스로도 끌 수 있게 한다.
  const bar = el(
    'div',
    null,
    'position:fixed;right:16px;bottom:16px;z-index:2147483000;box-sizing:border-box;max-width:320px;' +
      'padding:10px 14px;background:#fff;color:#111;border:3px solid #1d4ed8;border-radius:8px;' +
      'font:14px/1.5 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);'
  );
  bar.id = 'ssucream-explain-bar';
  const off = el('button', '항목 설명 모드 끄기', STYLE.button);
  off.type = 'button';
  off.addEventListener('click', toggle);
  bar.append(el('p', '항목 설명 모드: 설명을 볼 항목을 클릭하세요. (Esc로 끄기)', 'margin:0;'), off);

  async function explain(target) {
    if (busy) {
      announce('이전 항목을 설명하는 중입니다.');
      return;
    }
    busy = true;
    returnTo = target;
    const item = describe(target);
    picked.textContent = `고른 항목: ${item.kind}${item.name ? `, ${item.name}` : ''}`;
    result.textContent = '설명을 만드는 중입니다.';
    note.textContent = '';
    if (!dialog.open) dialog.showModal();
    // 기다리는 동안에도 점자로 다시 확인할 수 있게 설명 문단으로 포커스를 옮긴다.
    result.focus();
    announce('설명을 만드는 중입니다.');
    try {
      show((await chrome.runtime.sendMessage({ type: 'explain-item', item })) ?? { error: '응답이 없습니다.' });
    } catch (error) {
      show({ error: friendlyError(error) });
    } finally {
      busy = false;
    }
  }

  function show(response) {
    if (response.error) {
      result.textContent = `설명 실패. ${response.error}`;
    } else {
      result.textContent = `${response.description} (AI 설명)`;
      let text = 'AI가 만든 설명이라 틀릴 수 있습니다.';
      if (response.imageTruncated) text += ' 그림이 길어 앞부분만 읽었습니다.';
      note.textContent = text;
    }
    result.focus();
    // 이미 포커스가 있던 문단의 글자만 바뀌면 다시 읽지 않는 스크린리더가 있어 따로 알린다.
    announce(result.textContent);
  }

  // --- 모드 켜고 끄기
  function setHover(target) {
    if (hovered) hovered.style.outline = hoveredOutline;
    hovered = target;
    if (!target) return;
    hoveredOutline = target.style.outline;
    target.style.outline = '3px dashed #1d4ed8';
  }

  function onClick(event) {
    if (!on || !(event.target instanceof Element) || event.target.closest(OWN)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setHover(null);
    explain(pickTarget(event.target));
  }

  // 사이트가 mousedown·pointerup 등에서 동작하는 경우도 막는다. 설명은 click에서만 연다.
  const PRE_CLICK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick'];
  function onPreClick(event) {
    if (!(event.target instanceof Element) || event.target.closest(OWN)) return;
    if (event.type === 'auxclick') event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onHover(event) {
    if (!(event.target instanceof Element) || event.target.closest(OWN)) return setHover(null);
    const target = pickTarget(event.target);
    if (target !== hovered) setHover(target);
  }

  function onKey(event) {
    if (event.key === 'Escape' && !dialog.open) toggle();
  }

  function toggle() {
    on = !on;
    if (on) {
      document.body.append(dialog, bar);
      document.addEventListener('click', onClick, true);
      PRE_CLICK.forEach((type) => document.addEventListener(type, onPreClick, true));
      document.addEventListener('mouseover', onHover, true);
      document.addEventListener('keydown', onKey, true);
      announce('항목 설명 모드를 켰습니다. 설명을 볼 항목으로 이동해 Enter를 누르거나 클릭하세요. 끄려면 Esc를 누르거나, 온글 메뉴에서 항목 설명 모드를 다시 고르세요.');
    } else {
      if (dialog.open) dialog.close();
      dialog.remove();
      bar.remove();
      setHover(null);
      document.removeEventListener('click', onClick, true);
      PRE_CLICK.forEach((type) => document.removeEventListener(type, onPreClick, true));
      document.removeEventListener('mouseover', onHover, true);
      document.removeEventListener('keydown', onKey, true);
      announce('항목 설명 모드를 껐습니다.');
    }
  }

  window.__ssucreamExplain = toggle;
  toggle();
})();
