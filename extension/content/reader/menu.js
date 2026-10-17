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
  let mode = 'main'; // main(온글 메뉴) 또는 list(제목·링크 목록)
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

  function spoken(entry) {
    return entry.keyText ? `${entry.label}, ${entry.keyText}` : entry.label;
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
        { label: 'AI 결과 모음', keyText: keys.results, action: () => ns.ai.openResults() }
      );
    }
    list.push(
      { label: '제목 목록', action: () => openList('제목 목록', '제목', (item) => item.category === 'heading') },
      { label: '링크 목록', action: () => openList('링크 목록', '링크', (item) => item.category === 'link') },
      { label: '영역 목록', action: () => openList('영역 목록', '영역', (item) => item.category === 'landmark') },
      ...(ns.menuExtensions ?? []).flatMap((extend) => extend() ?? []),
      { label: '키 도움말', keyText: keys.help, action: () => reader.help() },
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
    mode = 'list';
    listTitle = title;
    show(list);
    ns.output.raise?.();
    guide('list-opened', { title, count: entries.length, position: 1, label: entries[0].label }, { interrupt: true });
  }

  // 제목·링크·영역 목록: 고르면 그 위치로 이동해 읽는다
  function openList(title, label, test) {
    const items = ns.reader.items.filter(test);
    if (!items.length) {
      // 오류 안내를 끝까지 들을 수 있게 메뉴 안내는 그 뒤에 이어서 읽는다
      guide('list-empty', { label }, { interrupt: true });
      openMenu({ interrupt: false });
      return;
    }
    mode = 'list';
    listTitle = title;
    show(
      items.map((item) => ({
        label: item.role === 'heading' ? `${item.name || '이름 없음'}, 제목 ${item.level}` : item.phrase,
        action: () => ns.reader.moveToElement(item.el)
      }))
    );
    guide('list-opened', { title, count: entries.length, position: 1, label: entries[0].label }, { interrupt: true });
  }

  function close({ announce = true } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    if (announce) guide('menu-closed', {}, { interrupt: true });
  }

  function choose() {
    const entry = entries[active];
    close({ announce: false });
    // 제목 목록 같은 항목은 실행하면서 목록을 다시 연다
    entry?.action();
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
    say(`첫 글자 ${jamo ?? latin}, 해당 항목 없음. 지금 위치는 ${entries[active].label}입니다.`, { interrupt: true });
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
        if (mode === 'list') openMenu();
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
    close,
    handleKey
  };
})();
