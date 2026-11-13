// 온글 메뉴: 온글이 할 수 있는 일을 목록으로 보여 주고 골라 실행한다. 단축키를 외우지 않아도 모든 기능을 쓸 수 있다.
// 위아래 화살표로 고르고 Enter로 실행, Esc로 닫기. 기능 이름의 첫 글자(영문 또는 한글 초성)로 이동.
// 열려 있는 동안 키는 reader.js가 이 모듈의 handleKey로 먼저 넘긴다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.menu) return;

  const STYLE = `
    .menu {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      box-sizing: border-box; width: min(560px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
      padding: 16px; border-radius: 12px; background: #fff; color: #111; border: 3px solid #1d4ed8;
      font: 18px/1.5 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45); z-index: 2147483647;
    }
    .menu[hidden] { display: none; }
    .menu h2 { margin: 0 0 8px; font-size: 20px; }
    .menu ol { list-style: none; margin: 0; padding: 0; }
    .menu li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: 6px; }
    .menu li.active { background: #1d4ed8; color: #fff; }
    .menu .key { font-size: 14px; opacity: 0.8; white-space: nowrap; }
    .menu .hint { display: block; font-size: 14px; opacity: 0.85; }
  `;

  // 2벌식 자판에서 키 위치(event.code)에 해당하는 한글 자음 (첫 글자 이동용)
  const JAMO_BY_CODE = {
    KeyQ: 'ㅂ', KeyW: 'ㅈ', KeyE: 'ㄷ', KeyR: 'ㄱ', KeyT: 'ㅅ', KeyA: 'ㅁ', KeyS: 'ㄴ', KeyD: 'ㅇ',
    KeyF: 'ㄹ', KeyG: 'ㅎ', KeyZ: 'ㅋ', KeyX: 'ㅌ', KeyC: 'ㅊ', KeyV: 'ㅍ'
  };
  const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const SIMPLE = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

  let panel = null;
  let titleEl = null;
  let listEl = null;
  let open = false;
  let mode = 'main'; // main(온글 메뉴) 또는 list(제목·링크 목록, 키 도움말 등)
  let backToMenu = true; // list에서 Esc를 누르면 온글 메뉴로 돌아갈지(아니면 닫기)
  let onCancel = null; // list를 Esc로 닫을 때 할 일 (새 탭 질문 등)
  let entries = [];
  let active = 0;
  let listTitle = '';

  const guide = (...args) => ns.reader?.guide(...args);
  const say = (text, options) => ns.output?.say(text, options);

  function firstKey(label) {
    const ch = label.trim()[0] ?? '';
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const jamo = CHOSEONG[Math.floor((code - 0xac00) / 588)];
      return SIMPLE[jamo] ?? jamo;
    }
    return ch.toUpperCase();
  }

  function ensurePanel() {
    const root = ns.output.ui();
    if (panel?.isConnected) return;
    ns.output.addStyle(STYLE);
    panel = document.createElement('div');
    panel.className = 'menu';
    panel.hidden = true;
    titleEl = document.createElement('h2');
    listEl = document.createElement('ol');
    panel.append(titleEl, listEl);
    root.append(panel);
  }

  function render() {
    titleEl.textContent = mode === 'main' ? '온글 메뉴' : listTitle;
    listEl.replaceChildren(
      ...entries.map((entry, i) => {
        const li = document.createElement('li');
        li.className = i === active ? 'active' : '';
        const label = document.createElement('span');
        label.textContent = entry.label;
        if (entry.hint) {
          const hint = document.createElement('span');
          hint.className = 'hint';
          hint.textContent = entry.hint;
          label.append(hint);
        }
        li.append(label);
        if (entry.keyText) {
          const key = document.createElement('span');
          key.className = 'key';
          key.textContent = entry.keyText;
          li.append(key);
        }
        return li;
      })
    );
    listEl.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  // 설명(hint)은 안내를 짧게 듣기로 한 사용자에게는 읽지 않는다 (화면에는 늘 보임)
  function spoken(entry) {
    const short = ns.reader?.settings?.reader?.verbosity === 'short';
    return [entry.label, entry.keyText, short ? '' : entry.hint].filter(Boolean).join(', ');
  }

  function announceActive() {
    say(`${spoken(entries[active])}, ${active + 1}/${entries.length}`, { interrupt: true });
  }

  // 지금 페이지에 맞는 메뉴 항목. 다른 모듈(점자 전달 테스트 등)은 ns.menuExtensions에 항목을 더한다.
  function mainEntries() {
    const reader = ns.reader;
    const keys = ns.guidance.keyNames(reader.settings.reader.commandKeys);
    const run = (command) => () => reader.runAi(command);
    // AI 기능은 웹페이지에서만 쓸 수 있다 (온글 설정 같은 확장 페이지에는 넣을 수 없음)
    const onWebPage = /^(https?|file):$/.test(location.protocol);
    // 첫 항목은 사용 가이드: 메뉴를 열면 가이드를 볼지 기능을 고를지 바로 선택하게 한다
    const list = [{ label: '사용 가이드', action: () => ns.guide.openContents() }];
    if (onWebPage) {
      list.push(
        { label: '페이지 요약', keyText: keys.summary, action: run('summarize-page') },
        { label: '페이지에 질문하기', keyText: keys.ask, action: run('ask-page') }
      );
      if (hasDetailImages()) list.push({ label: '상세 이미지 읽기', keyText: keys.detail, action: run('read-detail') });
      list.push(
        { label: '현재 항목 AI로 설명 듣기', keyText: keys.explain, action: () => ns.ai.explainCurrent() },
        { label: 'AI 결과 모음', keyText: keys.results, action: () => ns.ai.openResults() },
        {
          label: '상품 핵심 정보',
          keyText: keys.product,
          hint: '상품명, 가격, 옵션, 수량, 구매와 장바구니 버튼을 모아 듣고, 고르면 그 위치로 이동',
          action: () => openProduct()
        }
      );
    }
    list.push(
      {
        label: '제목 목록',
        hint: '페이지의 큰 제목과 소제목만 모아 듣고, 고르면 그 제목으로 이동',
        action: () => openList('제목 목록', '제목', (item) => item.category === 'heading')
      },
      {
        label: '링크 목록',
        hint: '다른 페이지로 가는 링크만 모아 듣고, 고르면 그 링크로 이동',
        action: () => openList('링크 목록', '링크', (item) => item.category === 'link')
      },
      {
        label: '버튼 목록',
        hint: '버튼만 모아 듣고, 고르면 그 버튼으로 이동. 이름이 같은 버튼은 바로 앞 제목을 함께 읽음',
        action: () => openList('버튼 목록', '버튼', (item) => item.category === 'button')
      },
      {
        label: '입력 요소 목록',
        hint: '편집창, 선택 상자, 체크박스, 라디오 버튼만 모아 듣고, 고르면 그 위치로 이동',
        action: () => openList('입력 요소 목록', '입력 요소', (item) => item.category === 'field')
      },
      {
        label: '영역 목록',
        hint: '머리말, 메뉴, 본문, 검색, 바닥글처럼 페이지를 나눈 구역을 모아 듣고, 고르면 그 구역 처음으로 이동',
        action: () => openList('영역 목록', '영역', (item) => item.category === 'landmark')
      },
      ...(ns.menuExtensions ?? []).flatMap((extend) => extend() ?? []),
      {
        label: '키 도움말',
        keyText: keys.help,
        hint: '온글 키를 목록으로 하나씩 듣기',
        action: () => openHelp({ back: true })
      },
      {
        label: '온글 설정',
        action: () => chrome.runtime.sendMessage({ type: 'ongeul-open-options' }).catch(() => {})
      },
      {
        label: '온글 끄기',
        keyText: reader.shortcuts.toggle,
        // 단축키와 같은 경로로 꺼서 "온글이 꺼졌습니다" 안내를 읽는다
        action: () => chrome.runtime.sendMessage({ type: 'ongeul-toggle', enabled: false }).catch(() => {})
      }
    );
    return list;
  }

  // 상세 설명 이미지가 있을 만한 페이지인지 (큰 그림이 본문에 있는지)
  function hasDetailImages() {
    return [...document.images].some((img) => {
      if (img.closest('header, nav, footer, [data-ongeul-ui]')) return false;
      const width = Number(img.getAttribute('width')) || img.naturalWidth || img.width;
      return width >= 400;
    });
  }

  function show(nextEntries, nextActive = 0) {
    ensurePanel();
    entries = nextEntries;
    active = Math.min(nextActive, entries.length - 1);
    panel.hidden = false;
    open = true;
    render();
  }

  // interrupt: false면 앞 안내("웹페이지로 이동했습니다" 등)를 끊지 않고 이어서 읽는다
  function openMenu({ interrupt = true } = {}) {
    if (!ns.reader?.enabled) return;
    mode = 'main';
    show(mainEntries());
    ns.output.raise?.();
    guide('menu-opened', { count: entries.length, position: 1, label: spoken(entries[0]) }, { interrupt });
  }

  // 목록 하나를 메뉴처럼 띄운다 (AI 결과 모음 등). entries: { label, action }
  function openEntries(title, list) {
    if (!ns.reader?.enabled || !list.length) return;
    setList(title);
    show(list);
    ns.output.raise?.();
    guide('list-opened', { title, count: entries.length, position: 1, label: entries[0].label }, { interrupt: true });
  }

  // 상품 핵심 정보 목록 (product.js): 상품명, 가격, 옵션, 수량, 구매·장바구니. 고르면 그 위치로 이동해 읽는다
  function openProduct() {
    const reader = ns.reader;
    if (!reader?.enabled) return;
    const points = ns.product.keyPoints(reader.items, ns.product.pageMeta());
    if (!points.length) {
      guide('product-empty', {}, { interrupt: true });
      openMenu({ interrupt: false });
      return;
    }
    openEntries(
      '상품 핵심 정보',
      points.map(({ label, item }) => ({ label, action: () => reader.moveToElement(item.el) }))
    );
  }

  // 같은 이름이 여러 번 나오는 항목(상품마다 있는 "장바구니 담기" 등)은 바로 앞 제목을 붙여 구분한다.
  // 돌려주는 값: Map(항목 → "스텐 텀블러 아래"). 앞에 제목이 없거나 앞 제목까지 같으면 "3번째"처럼 순서를 붙인다
  function placeNames(all, items) {
    const count = new Map();
    for (const item of items) count.set(item.phrase, (count.get(item.phrase) ?? 0) + 1);
    const where = new Map();
    const seen = new Map();
    let heading = '';
    const wanted = new Set(items);
    for (const item of all) {
      if (item.category === 'heading' && item.name) heading = item.name;
      if (!wanted.has(item) || item.role === 'heading' || count.get(item.phrase) < 2) continue;
      where.set(item, heading ? `${heading} 아래` : '');
    }
    // 앞 제목으로도 구분되지 않으면 같은 이름 가운데 몇 번째인지 붙인다
    const byPlace = new Map();
    for (const [item, place] of where) {
      const key = `${item.phrase}\n${place}`;
      byPlace.set(key, (byPlace.get(key) ?? 0) + 1);
    }
    for (const [item, place] of where) {
      const key = `${item.phrase}\n${place}`;
      if (byPlace.get(key) < 2) continue;
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      where.set(item, [place, `${nth}번째`].filter(Boolean).join(', '));
    }
    for (const [item, place] of where) if (!place) where.delete(item);
    return where;
  }

  // 제목·링크·영역·버튼·입력 요소 목록: 고르면 그 위치로 이동해 읽는다
  function openList(title, label, test) {
    const all = ns.reader.items;
    const items = all.filter(test);
    if (!items.length) {
      // 오류 안내를 끝까지 들을 수 있게 메뉴 안내는 그 뒤에 이어서 읽는다
      guide('list-empty', { label }, { interrupt: true });
      openMenu({ interrupt: false });
      return;
    }
    const where = placeNames(all, items);
    setList(title);
    show(
      items.map((item) => ({
        label: item.role === 'heading' ? `${item.name || '이름 없음'}, 제목 ${item.level}` : where.has(item) ? `${item.phrase}, ${where.get(item)}` : item.phrase,
        action: () => ns.reader.moveToElement(item.el)
      }))
    );
    guide('list-opened', { title, count: entries.length, position: 1, label: entries[0].label }, { interrupt: true });
  }

  function setList(title, { back = true, cancel = null } = {}) {
    mode = 'list';
    listTitle = title;
    backToMenu = back;
    onCancel = cancel;
  }

  // 키 도움말: 키 하나를 한 항목으로 띄워 위아래 화살표로 하나씩 듣는다. back: Esc로 온글 메뉴로 돌아갈지
  function openHelp({ back = false } = {}) {
    const r = ns.reader;
    if (!r?.enabled) return;
    const list = ns.guidance.helpEntries({ ...r.shortcuts, keys: ns.guidance.keyNames(r.settings.reader.commandKeys) });
    setList('키 도움말', { back });
    show(list);
    ns.output.raise?.();
    guide('help-opened', { count: entries.length, position: 1, label: spoken(entries[0]), back }, { interrupt: true });
  }

  // 질문 하나와 고를 답을 목록으로 띄운다 (새 탭 질문). guideId의 안내가 질문을 읽고 첫 답을 이어서 읽는다.
  // cancel: Esc로 답하지 않고 닫았을 때 할 일
  function openChoice(title, guideId, list, { cancel = null, interrupt = false } = {}) {
    if (!ns.reader?.enabled || !list.length) return;
    setList(title, { back: false, cancel });
    show(list);
    ns.output.raise?.();
    guide(guideId, { count: entries.length, position: 1, label: spoken(entries[0]) }, { interrupt });
  }

  function close({ announce = true } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    // 점자: 닫았다는 알림이 사라지면 메뉴 항목이 아니라 읽던 위치를 보이도록
    const r = ns.reader;
    const item = r?.items?.[r.index];
    if (item) ns.braille?.setContent?.(item.phrase);
    if (announce) guide('menu-closed', {}, { interrupt: true });
  }

  function choose() {
    const entry = entries[active];
    // 키 도움말처럼 실행할 것이 없는 항목은 다시 읽기만 한다
    if (!entry?.action) {
      announceActive();
      return;
    }
    close({ announce: false });
    // 제목 목록 같은 항목은 실행하면서 목록을 다시 연다
    entry.action();
  }

  function moveBy(delta) {
    active = (active + delta + entries.length) % entries.length;
    render();
    announceActive();
  }

  function jumpByLetter(code) {
    const latin = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : '';
    const jamo = JAMO_BY_CODE[code];
    if (!latin && !jamo) return false;
    for (let step = 1; step <= entries.length; step++) {
      const i = (active + step) % entries.length;
      const key = firstKey(entries[i].label);
      if (key === latin || key === jamo) {
        active = i;
        render();
        announceActive();
        return true;
      }
    }
    say(`첫 글자 ${jamo ?? latin}, 해당 항목 없음. 지금 위치는 ${entries[active].label}입니다.`, { interrupt: true, message: true });
    return true;
  }

  // 메뉴가 열려 있을 때 키 처리. 처리했으면 true
  function handleKey(event) {
    if (!open) return false;
    switch (event.code) {
      case 'ArrowDown':
        moveBy(1);
        return true;
      case 'ArrowUp':
        moveBy(-1);
        return true;
      case 'Home':
        active = 0;
        render();
        announceActive();
        return true;
      case 'End':
        active = entries.length - 1;
        render();
        announceActive();
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        choose();
        return true;
      case 'Escape':
        if (mode === 'list' && onCancel) {
          const cancel = onCancel;
          close({ announce: false });
          cancel();
        } else if (mode === 'list' && backToMenu) openMenu();
        else close();
        return true;
      case 'Tab':
        moveBy(event.shiftKey ? -1 : 1);
        return true;
      default:
        // 메뉴가 쓰지 않는 조합 키(F5, Alt+←, Ctrl 등)는 페이지·브라우저로 넘긴다
        if (event.ctrlKey || event.altKey || event.metaKey) return false;
        return jumpByLetter(event.code);
    }
  }

  ns.menu = {
    get isOpen() {
      return open;
    },
    openMenu,
    openEntries,
    openProduct,
    openHelp,
    openChoice,
    close,
    handleKey
  };
})();
