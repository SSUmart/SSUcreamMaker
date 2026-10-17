// 온글 읽기 엔진(R1): 페이지를 읽기 순서 목록으로 만든다.
// 항목마다 종류(role), 이름(name), 상태(states), 값(value)을 계산하고, 읽을 문장(phrase)을 만든다.
// 이 문장 하나가 화면 오버레이, 음성, 점자 출력의 공통 원본이 된다.
// content script로 주입되며 globalThis.__ongeul.model로 내보낸다. 여러 번 주입돼도 한 번만 정의한다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.model) return;

  // 온글 자신의 화면(오버레이, 가상 점자 디스플레이, 대화상자)은 읽기 대상에서 뺀다.
  const OWN = '[data-ongeul-ui], #ssucream-status';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'CANVAS', 'OBJECT', 'EMBED']);
  // 한 항목으로 읽기에 너무 긴 글은 문장 단위로 나눈다 (점자 한 줄 40칸, 음성 한 번에 듣기 좋은 길이)
  const MAX_CHUNK = 300;
  const MAX_NAME = 500;
  // 상세 이미지 후보의 최소 화면 너비 (detail.js collectImages와 같은 기준)
  const DETAIL_MIN_WIDTH = 300;

  // 읽을 때 쓰는 종류 이름 (NVDA·센스리더 한국어 안내를 참고)
  const ROLE_NAMES = {
    link: '링크',
    button: '버튼',
    checkbox: '체크박스',
    radio: '라디오 버튼',
    switch: '전환 버튼',
    textbox: '편집창',
    searchbox: '검색 편집창',
    password: '비밀번호 편집창',
    combobox: '콤보 상자',
    listbox: '목록 상자',
    option: '선택 항목',
    slider: '슬라이더',
    spinbutton: '숫자 편집창',
    progressbar: '진행 막대',
    meter: '측정 막대',
    tab: '탭',
    tabpanel: '탭 패널',
    menuitem: '메뉴 항목',
    menu: '메뉴',
    img: '그래픽',
    heading: '제목',
    list: '목록',
    table: '표',
    row: '표 행',
    dialog: '대화상자',
    group: '그룹',
    frame: '프레임',
    banner: '머리말 영역',
    navigation: '탐색 영역',
    main: '본문 영역',
    contentinfo: '꼬리말 영역',
    search: '검색 영역',
    complementary: '보조 영역',
    region: '영역',
    form: '양식',
    text: ''
  };

  // 이동 명령(R2)에서 쓰는 분류
  const CATEGORY = {
    link: 'link',
    button: 'button',
    switch: 'button',
    checkbox: 'field',
    radio: 'field',
    textbox: 'field',
    searchbox: 'field',
    password: 'field',
    combobox: 'field',
    listbox: 'field',
    slider: 'field',
    spinbutton: 'field',
    img: 'graphic',
    heading: 'heading',
    list: 'list',
    table: 'table',
    banner: 'landmark',
    navigation: 'landmark',
    main: 'landmark',
    contentinfo: 'landmark',
    search: 'landmark',
    complementary: 'landmark',
    region: 'landmark',
    form: 'landmark'
  };

  const LANDMARK_TAGS = { NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', SEARCH: 'search' };
  const INPUT_ROLES = {
    checkbox: 'checkbox',
    radio: 'radio',
    search: 'searchbox',
    password: 'password',
    number: 'spinbutton',
    range: 'slider',
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button'
  };
  // 그 자체로 하나의 항목이 되는 종류 (안의 글자를 따로 읽지 않음)
  const ATOMIC = new Set([
    'link', 'button', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'password', 'combobox',
    'listbox', 'slider', 'spinbutton', 'progressbar', 'meter', 'tab', 'menuitem', 'option', 'img', 'heading', 'frame'
  ]);
  // 항목이지만 안에 누를 수 있는 요소가 있으면 그것도 따로 항목으로 넣는 종류 (제목 안의 링크 등)
  const SCAN_INSIDE = new Set(['heading']);
  // 이름 없이 있으면 사용자가 무엇인지 알 수 없는 종류 (AI 자동 보완 대상)
  const NEEDS_NAME = new Set(['link', 'button', 'switch', 'img', 'tab', 'menuitem', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox']);
  // 이름을 내용 글자로 정하는 종류
  const NAME_FROM_CONTENT = new Set(['link', 'button', 'switch', 'tab', 'menuitem', 'option', 'heading', 'checkbox', 'radio']);

  const clean = (text, max = MAX_NAME) => {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
  };

  function isOwn(el) {
    return Boolean(el.closest?.(OWN));
  }

  function tagOf(el) {
    return el.tagName.toUpperCase();
  }

  // 숨겨진 요소. sr-only처럼 화면에서만 숨긴 글은 숨겨진 것이 아니다 (checkVisibility가 true).
  function hidden(el) {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    if (el.closest('[inert]')) return true;
    // display: contents 요소는 자기 상자가 없어 checkVisibility가 false일 수 있지만 자식은 보인다
    if (getComputedStyle(el).display === 'contents') return false;
    return typeof el.checkVisibility === 'function' ? !el.checkVisibility({ visibilityProperty: true }) : false;
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0];
    if (explicit === 'presentation' || explicit === 'none') return null;
    if (explicit) return explicit;
    const tag = tagOf(el);
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'hidden') return null;
      return INPUT_ROLES[type] ?? 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'IMG') return el.getAttribute('alt') === '' ? null : 'img';
    if (tag === 'PROGRESS') return 'progressbar';
    if (tag === 'METER') return 'meter';
    if (tag === 'IFRAME' || tag === 'FRAME') return 'frame';
    if (tag === 'AREA' && el.hasAttribute('href')) return 'link';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'UL' || tag === 'OL') return 'list';
    if (tag === 'TABLE') return isLayoutTable(el) ? null : 'table';
    if (tag === 'DIALOG') return 'dialog';
    if (tag === 'FIELDSET') return 'group';
    if (LANDMARK_TAGS[tag]) return LANDMARK_TAGS[tag];
    // header·footer는 본문(article, main) 안에 있지 않을 때만 영역
    if (tag === 'HEADER' && !el.closest('article, main, [role="main"]')) return 'banner';
    if (tag === 'FOOTER' && !el.closest('article, main, [role="main"]')) return 'contentinfo';
    // section·form은 작성자가 이름(aria-label, aria-labelledby, title)을 붙였을 때만 영역으로 본다.
    // (accessibleName은 roleOf를 다시 부르므로 여기서는 쓰지 않는다)
    if (tag === 'SECTION' || tag === 'FORM') {
      const named = el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim() || el.getAttribute('title')?.trim();
      return named ? (tag === 'FORM' ? 'form' : 'region') : null;
    }
    // div onclick 같은 가짜 버튼
    if (el.hasAttribute('onclick') && (tag === 'DIV' || tag === 'SPAN')) return 'button';
    return null;
  }

  // 레이아웃용 표: 제목 칸·표 제목이 없고 안에 표나 제목·양식이 들어 있거나 한 줄뿐인 표 (오래된 사이트의 화면 배치)
  function isLayoutTable(table) {
    if (table.querySelector(':scope > caption, th, [role="columnheader"], [role="rowheader"]')) return false;
    return Boolean(table.querySelector('table, h1, h2, h3, h4, h5, h6, form')) || table.rows.length <= 1;
  }

  // 요소의 자식 노드 (열린 Shadow DOM이 있으면 그 안, slot이면 넣어진 노드)
  function childrenOf(node) {
    if (node.shadowRoot) return node.shadowRoot.childNodes;
    if (node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true });
      return assigned.length ? assigned : node.childNodes;
    }
    return node.childNodes;
  }

  function parentOf(node) {
    return node.parentElement ?? node.parentNode?.host ?? null;
  }

  // 글 흐름 안의 요소인가. 화면에서 감추고 스크린리더에만 주는 글(sr-only: 절대 위치 + 1px 상자)은
  // 브라우저가 블록으로 바꿔 계산하지만, 앞뒤 글과 이어지는 문장이므로 인라인으로 본다
  function isInline(el) {
    const style = getComputedStyle(el);
    if (style.display === 'inline' || style.display === 'contents') return true;
    return isVisuallyHidden(style);
  }

  function isVisuallyHidden(style) {
    if (style.position !== 'absolute' && style.position !== 'fixed') return false;
    const tiny = parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1;
    const clipped = /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(style.clip) || /inset\(50%\)/.test(style.clipPath);
    return tiny || clipped;
  }

  function svgTitle(svg) {
    return clean([...svg.children].find((child) => tagOf(child) === 'TITLE')?.textContent);
  }

  // 링크·버튼처럼 내용으로 이름을 정하는 요소의 글자: 안의 그림 alt, aria-label도 포함.
  // 숨겨진 글은 빼고, 인라인 요소 사이에는 공백을 넣지 않는다 ("24,<b>900</b>원" → "24,900원")
  function contentText(el) {
    let out = '';
    for (const node of childrenOf(el)) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.data;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = tagOf(node);
      if (SKIP_TAGS.has(tag)) continue;
      // 레이블 안의 입력창·선택 상자 값은 이름에 넣지 않는다
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') continue;
      if (node.getAttribute('aria-hidden') === 'true') continue;
      if (tag !== 'SVG' && hidden(node)) continue;
      const gap = tag === 'BR' || (tag !== 'SVG' && !isInline(node)) ? ' ' : '';
      const label = clean(node.getAttribute('aria-label'));
      let text;
      if (label) text = label;
      else if (tag === 'IMG') text = node.getAttribute('alt') ?? '';
      else if (tag === 'SVG') text = svgTitle(node);
      else text = contentText(node);
      out += `${gap}${text}${gap}`;
    }
    return clean(out);
  }

  // aria-labelledby가 가리키는 요소들의 글 (숨겨진 요소라도 이름으로는 쓴다: W3C 규칙)
  function textOfIds(ids) {
    return clean(
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => clean(el.getAttribute('aria-label')) || (tagOf(el) === 'IMG' ? clean(el.getAttribute('alt')) : clean(el.textContent)))
        .join(' ')
    );
  }

  function labelText(el) {
    const labels = el.labels ? [...el.labels] : [];
    return clean(labels.map((label) => contentText(label)).join(' '));
  }

  // 접근 가능한 이름 계산 (W3C accname 규칙을 간단히 따른 것)
  function accessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = textOfIds(labelledby);
      if (text) return { name: text, source: 'aria-labelledby' };
    }
    const label = clean(el.getAttribute('aria-label'));
    if (label) return { name: label, source: 'aria-label' };

    const tag = tagOf(el);
    if (tag === 'IMG' || (tag === 'INPUT' && el.type === 'image') || tag === 'AREA') {
      const alt = clean(el.getAttribute('alt'));
      if (alt) return { name: alt, source: 'alt' };
    }
    if (tag === 'SVG') {
      const title = svgTitle(el);
      if (title) return { name: title, source: 'title' };
    }
    if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag)) {
      const text = labelText(el);
      if (text) return { name: text, source: 'label' };
      if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) {
        const value = clean(el.value || { submit: '제출', reset: '초기화' }[el.type]);
        if (value) return { name: value, source: 'value' };
      }
    }
    if (tag === 'FIELDSET') {
      const legend = el.querySelector(':scope > legend');
      if (legend) return { name: contentText(legend), source: 'legend' };
    }
    if (tag === 'TABLE') {
      const caption = el.querySelector(':scope > caption');
      if (caption) return { name: contentText(caption), source: 'caption' };
    }
    const role = roleOf(el);
    if (role && NAME_FROM_CONTENT.has(role)) {
      const text = contentText(el);
      if (text) return { name: text, source: 'content' };
    }
    const title = clean(el.getAttribute('title'));
    if (title) return { name: title, source: 'title' };
    const placeholder = clean(el.getAttribute('placeholder'));
    if (placeholder) return { name: placeholder, source: 'placeholder' };
    return { name: '', source: 'none' };
  }

  function aria(el, name) {
    return el.getAttribute(`aria-${name}`);
  }

  function statesOf(el, role) {
    const states = [];
    if (['checkbox', 'radio', 'switch'].includes(role)) {
      const checked = tagOf(el) === 'INPUT' ? el.checked : aria(el, 'checked') === 'true';
      if (aria(el, 'checked') === 'mixed' || el.indeterminate) states.push('일부 선택됨');
      else if (role === 'switch') states.push(checked ? '켜짐' : '꺼짐');
      else states.push(checked ? '선택됨' : '선택 안 됨');
    }
    if (aria(el, 'pressed') !== null) states.push(aria(el, 'pressed') === 'true' ? '눌림' : '눌리지 않음');
    if (aria(el, 'expanded') !== null) states.push(aria(el, 'expanded') === 'true' ? '펼쳐짐' : '접힘');
    if (role === 'tab' && aria(el, 'selected') === 'true') states.push('선택됨');
    if (aria(el, 'current') && aria(el, 'current') !== 'false') states.push(aria(el, 'current') === 'page' ? '현재 페이지' : '현재 항목');
    if (el.disabled || aria(el, 'disabled') === 'true') states.push('사용할 수 없음');
    if (el.required || aria(el, 'required') === 'true') states.push('필수');
    if (el.readOnly || aria(el, 'readonly') === 'true') states.push('읽기 전용');
    if (aria(el, 'invalid') === 'true') states.push('잘못된 입력');
    if (role === 'link' && tagOf(el) === 'A' && el.target === '_blank') states.push('새 창');
    return states;
  }

  // 편집창·콤보 상자 등의 현재 값. 비밀번호는 글자 대신 개수만 읽는다.
  function valueOf(el, role) {
    const tag = tagOf(el);
    if (role === 'password') return el.value ? `입력된 글자 ${el.value.length}개` : '';
    if (tag === 'SELECT') return clean([...el.selectedOptions].map((o) => o.textContent).join(', '), 200);
    if (tag === 'PROGRESS' || tag === 'METER') {
      const max = Number(el.max) || 1;
      return Number.isFinite(el.value) ? `${Math.round((el.value / max) * 100)}%` : '';
    }
    if (['textbox', 'searchbox', 'spinbutton', 'slider'].includes(role)) {
      if (tag === 'INPUT' || tag === 'TEXTAREA') return clean(el.value, 200);
      return clean(aria(el, 'valuetext') ?? aria(el, 'valuenow') ?? el.textContent, 200);
    }
    if (role === 'combobox') return clean(el.value ?? aria(el, 'valuetext') ?? '', 200);
    if (role === 'progressbar' || role === 'meter') return clean(aria(el, 'valuetext') ?? aria(el, 'valuenow') ?? '', 50);
    return '';
  }

  function headingLevel(el) {
    const match = tagOf(el).match(/^H([1-6])$/);
    return match ? Number(match[1]) : Number(el.getAttribute('aria-level')) || 2;
  }

  // 라디오·탭처럼 묶음 안에서의 위치 ("2/3")
  function positionOf(el, role) {
    let group = [];
    if (role === 'radio' && tagOf(el) === 'INPUT' && el.name) {
      const form = el.form ?? document;
      group = [...form.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
    } else if (role === 'tab') {
      group = [...(el.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? [])];
    } else if (role === 'radio') {
      group = [...(el.closest('[role="radiogroup"]')?.querySelectorAll('[role="radio"]') ?? [])];
    }
    const index = group.indexOf(el);
    return index >= 0 && group.length > 1 ? `${index + 1}/${group.length}` : '';
  }

  // 목록·표·영역에 들어설 때 읽는 안내
  function containerSummary(el, role) {
    if (role === 'list') {
      const count = [...el.children].filter((child) => tagOf(child) === 'LI' || child.getAttribute('role') === 'listitem').length;
      return `항목 ${count}개`;
    }
    if (role === 'table' && tagOf(el) === 'TABLE') {
      const rows = [...el.rows].filter((row) => !hidden(row));
      const cols = Math.max(0, ...rows.map((row) => row.cells.length));
      return `${rows.length}행 ${cols}열`;
    }
    return '';
  }

  // 항목 하나의 읽기 문장. 순서: 이름 → 종류(수준) → 요약 → 상태 → 값 → 위치
  function phraseOf(item) {
    if (item.role === 'text') return item.name;
    const parts = [];
    const roleName = item.role === 'heading' ? `${ROLE_NAMES.heading} ${item.level}` : ROLE_NAMES[item.role] ?? '';
    if (item.name) parts.push(item.aiName ? `${item.name}, AI 추정` : item.name);
    else if (item.needsName) parts.push('이름 없음');
    if (roleName) parts.push(roleName);
    if (item.summary) parts.push(item.summary);
    parts.push(...item.states);
    if (item.value) parts.push(item.value);
    if (item.position) parts.push(item.position);
    if (item.role === 'frame') parts.push('안의 내용은 온글이 아직 읽을 수 없습니다');
    return parts.join(', ');
  }

  function makeItem(el, role, extra = {}) {
    const { name, source } = role === 'text' ? { name: '', source: 'content' } : accessibleName(el);
    const item = {
      el,
      role,
      category: CATEGORY[role] ?? (role === 'text' ? 'text' : 'other'),
      name,
      nameSource: source,
      needsName: NEEDS_NAME.has(role) && !name,
      aiName: false,
      level: role === 'heading' ? headingLevel(el) : 0,
      states: role === 'text' ? [] : statesOf(el, role),
      value: role === 'text' ? '' : valueOf(el, role),
      position: role === 'text' ? '' : positionOf(el, role),
      summary: '',
      ...extra
    };
    item.phrase = phraseOf(item);
    return item;
  }

  // 긴 글을 문장 단위로 나눠 MAX_CHUNK 이하 조각으로 만든다
  function chunks(text) {
    if (text.length <= MAX_CHUNK) return [text];
    const sentences = text.match(/[^.!?。]+[.!?。]+["'”’)]*\s*|[^.!?。]+$/g) ?? [text];
    const out = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && (current + sentence).length > MAX_CHUNK) {
        out.push(current.trim());
        current = '';
      }
      // 한 문장이 너무 길면 글자 수로 자른다
      let rest = sentence;
      while (rest.length > MAX_CHUNK) {
        out.push(rest.slice(0, MAX_CHUNK).trim());
        rest = rest.slice(MAX_CHUNK);
      }
      current += rest;
    }
    if (current.trim()) out.push(current.trim());
    return out.filter(Boolean);
  }

  // 지금 읽을 범위: 모달 대화상자가 열려 있으면 그 안만 (밖은 사용할 수 없는 상태)
  function readingRoot() {
    const modal =
      document.querySelector('dialog:modal') ??
      [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].find((el) => !hidden(el));
    return modal ?? document.body;
  }

  // 페이지를 문서 순서대로 훑어 읽기 순서 목록을 만든다.
  // 쇼핑몰 상세 이미지 후보: 대체 텍스트가 비어(alt="") 장식으로 보이지만 머리말·메뉴·꼬리말 밖의 큰 그림.
  // 실제로는 글자가 든 정보 이미지인 경우가 많다.
  function isDetailImage(img) {
    return (
      img.getAttribute('alt') === '' &&
      !img.closest('header, nav, footer') &&
      img.getBoundingClientRect().width >= DETAIL_MIN_WIDTH
    );
  }

  // 상세 이미지 후보가 처음 나오는 자리에서 한 번 읽는 안내. 상세 이미지 읽기를 이미 했으면 그 결과 상자를 읽으므로 안내하지 않는다.
  function detailHint(root) {
    const result = document.getElementById('ssucream-detail');
    if (result && !result.hidden) return '';
    const images = [...root.querySelectorAll('img[alt=""]')].filter((img) => !hidden(img) && isDetailImage(img));
    // 서비스 워커의 상세 이미지 판별과 같은 기준: 세로로 긴 그림이 있거나, 같은 너비 그림이 3장 이상 (넓은 배너만 있으면 안내하지 않음)
    const sizes = images.map((img) => img.getBoundingClientRect());
    const tall = sizes.some(({ width, height }) => height >= width * 1.2);
    const sameWidth = sizes.filter(({ width }) => Math.abs(width - sizes[0].width) < 1).length >= 3;
    if (!tall && !sameWidth) return '';
    const count = images.length;
    const key = `${ns.guidance?.keyNames(ns.reader?.settings?.reader?.commandKeys).detail ?? 'Alt와 Shift와 D'} 키`;
    return result
      ? `상세 이미지 ${count}개. AI가 읽은 내용을 닫아 두었습니다. ${key}를 누르면 다시 엽니다.`
      : `상세 이미지 ${count}개, 글자가 든 그림일 수 있습니다. ${key}를 누르면 AI가 읽습니다.`;
  }

  function buildItems(root = readingRoot()) {
    const items = [];
    if (!root) return items;
    let pending = null; // 아직 끝나지 않은 글 항목 { el, text }
    let detailHintDone = false;

    const flush = () => {
      if (!pending) return;
      const text = clean(pending.text, Infinity);
      if (text) {
        for (const part of chunks(text)) items.push(makeItem(pending.el, 'text', { name: part, phrase: part }));
      }
      pending = null;
    };

    const inlines = new Map();
    const inlineOf = (el) => {
      if (!inlines.has(el)) inlines.set(el, isInline(el));
      return inlines.get(el);
    };

    // 글자가 속한 블록 요소 (같은 블록의 글은 한 항목으로 묶음)
    const blockOf = (node) => {
      let el = parentOf(node);
      while (el && el !== root) {
        if (!inlineOf(el)) return el;
        el = parentOf(el);
      }
      return root;
    };

    const push = (el, role, extra) => {
      flush();
      items.push(makeItem(el, role, extra));
    };

    // 항목 안에 들어 있는 누를 수 있는 요소만 따로 항목으로 넣는다 (제목 안 링크, 표 칸 안 버튼 등)
    const pushInteractive = (container) => {
      for (const node of childrenOf(container)) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOwn(node) || SKIP_TAGS.has(tagOf(node)) || hidden(node)) continue;
        const role = roleOf(node);
        if (role && ATOMIC.has(role) && role !== 'heading' && role !== 'img') push(node, role);
        else if (tagOf(node) === 'LABEL' && node.control && node.contains(node.control) && roleOf(node.control)) {
          push(node.control, roleOf(node.control));
        } else pushInteractive(node);
      }
    };

    const walk = (parent) => {
      for (const node of childrenOf(parent)) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.data.trim()) continue;
          const block = blockOf(node);
          if (pending && pending.el !== block) flush();
          pending ??= { el: block, text: '' };
          pending.text += node.data;
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = tagOf(node);
        if (isOwn(node) || SKIP_TAGS.has(tag) || hidden(node)) continue;
        if (tag === 'SVG') {
          // 그림 역할과 이름이 있는 SVG만 그래픽으로 읽고, 장식용 아이콘은 건너뛴다
          if (roleOf(node) === 'img' && accessibleName(node).name) push(node, 'img');
          continue;
        }
        // 레이블 글은 연결된 입력창이 이름으로 읽으므로 따로 읽지 않는다 (안에 든 입력창만 항목으로)
        if (tag === 'LABEL' && node.control && !hidden(node.control)) {
          if (node.contains(node.control)) {
            const role = roleOf(node.control);
            if (role) push(node.control, role);
          }
          continue;
        }
        // 묶음 제목(legend)은 그룹 이름으로 읽는다
        if (tag === 'LEGEND' && node.parentElement && tagOf(node.parentElement) === 'FIELDSET') continue;

        const role = roleOf(node);
        // 장식으로 보이는(alt="") 상세 이미지: 첫 자리에서 상세 이미지 읽기를 안내한다 (작은 장식 그림은 그대로 건너뜀)
        if (tag === 'IMG' && !role && !detailHintDone && isDetailImage(node)) {
          detailHintDone = true;
          const hint = detailHint(root);
          if (hint) push(node, 'text', { name: hint, phrase: hint, detailHint: true });
          continue;
        }
        if (role && ATOMIC.has(role)) {
          push(node, role);
          if (SCAN_INSIDE.has(role)) pushInteractive(node);
          continue;
        }
        if (role === 'table' && tag === 'TABLE') {
          push(node, 'table', { summary: containerSummary(node, 'table') });
          for (const row of node.rows) {
            if (hidden(row)) continue;
            const cells = [...row.cells].filter((cell) => !hidden(cell)).map((cell) => contentText(cell)).filter(Boolean);
            if (cells.length) push(row, 'text', { name: cells.join(', '), phrase: cells.join(', ') });
            pushInteractive(row);
          }
          continue;
        }
        if (role && (['list', 'table', 'dialog', 'group', 'tabpanel', 'menu', 'listbox'].includes(role) || CATEGORY[role] === 'landmark')) {
          flush();
          const summary = containerSummary(node, role);
          const entry = makeItem(node, role, { summary });
          // 이름 없는 그룹·탭 패널은 따로 안내하지 않는다
          if (entry.name || summary || CATEGORY[role] === 'landmark' || role === 'dialog') items.push(entry);
          walk(node);
          flush();
          continue;
        }
        walk(node);
      }
    };

    walk(root);
    flush();
    return items;
  }

  // 요소에 해당하는 항목 위치. exact가 아니면 조상 항목까지 찾는다(원문 이동, 목록 갱신 후 위치 유지).
  function indexOfElement(items, el, { exact = false } = {}) {
    let node = el;
    while (node) {
      const index = items.findIndex((item) => item.el === node);
      if (index !== -1) return index;
      if (exact) return -1;
      node = parentOf(node);
    }
    return -1;
  }

  // 목록에 없는 요소(초점이 막 옮겨진 새 요소 등)를 읽을 항목 하나로 만든다
  function itemFor(el) {
    const role = roleOf(el);
    if (role) return makeItem(el, role, { summary: containerSummary(el, role) });
    const text = contentText(el);
    return makeItem(el, 'text', { name: text, phrase: text });
  }

  // 페이지가 바뀌면 다시 만들라고 알린다. 여러 변화는 묶되, 계속 바뀌는 페이지(움직이는 배너 등)에서도
  // 최대 maxWait마다 한 번은 다시 만든다. body가 통째로 바뀌는 사이트도 따라가도록 문서 전체를 본다.
  function watch(onChange, { delay = 300, maxWait = 1000 } = {}) {
    let timer = null;
    let firstChange = 0;
    const run = () => {
      timer = null;
      firstChange = 0;
      onChange();
    };
    const observer = new MutationObserver((mutations) => {
      const own = (m) => isOwn(m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement ?? document.documentElement);
      if (mutations.every(own)) return;
      const now = performance.now();
      firstChange ||= now;
      clearTimeout(timer);
      timer = setTimeout(run, Math.max(0, Math.min(delay, firstChange + maxWait - now)));
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-expanded', 'aria-checked',
        'aria-pressed', 'aria-selected', 'aria-current', 'aria-disabled', 'aria-modal', 'alt', 'class', 'style',
        'disabled', 'open', 'inert']
    });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }

  ns.model = {
    ROLE_NAMES,
    buildItems,
    readingRoot,
    phraseOf,
    accessibleName,
    roleOf,
    indexOfElement,
    itemFor,
    watch,
    refreshItem(item) {
      // 상태가 바뀐 항목(체크박스를 누른 뒤 등)의 문장을 다시 만든다. 글 항목은 목록을 다시 만들 때 갱신된다.
      if (item.role === 'text') return item;
      const next = makeItem(item.el, item.role, { summary: item.summary });
      if (item.aiName) {
        Object.assign(next, { name: item.name, aiName: true, needsName: false });
        next.phrase = phraseOf(next);
      }
      return next;
    }
  };
})();
