// 온글 스크린리더 본체(R2): 읽기 위치(가상 커서), 읽기·글쓰기 모드, NVDA·센스리더 방식 키 명령.
// 모든 페이지에 content script로 들어가고, 온글이 켜져 있을 때만(storage.local의 readerEnabled) 동작한다.
// 읽은 문장은 __ongeul.output(화면 오버레이·음성·점자)으로 보내고, 안내 문구는 __ongeul.guidance에서 고른다.
// 주입 순서: defaults.js → guidance.js → model.js → output.js → menu.js → reader.js
(() => {
  const ns = (globalThis.__ongeul ??= {});
  // 확장을 업데이트하면 예전 온글이 페이지에 남는다. 예전 것이 연결이 끊겼으면 끄고 새로 정의한다.
  if (ns.reader) {
    if (ns.reader.alive()) return;
    ns.reader.disable();
  }
  const { model, guidance } = ns;

  // 한 글자 이동 키 (event.code 기준이라 한글 입력 상태에서도 동작). Shift를 함께 누르면 위쪽으로
  const QUICK_KEYS = {
    KeyH: { test: (item) => item.category === 'heading', label: '제목' },
    KeyK: { test: (item) => item.category === 'link', label: '링크' },
    KeyB: { test: (item) => item.category === 'button', label: '버튼' },
    KeyF: { test: (item) => item.category === 'field', label: '입력 요소' },
    KeyE: { test: (item) => ['textbox', 'searchbox', 'password', 'spinbutton'].includes(item.role), label: '편집창' },
    KeyX: { test: (item) => item.role === 'checkbox', label: '체크박스' },
    KeyR: { test: (item) => item.role === 'radio', label: '라디오 버튼' },
    KeyC: { test: (item) => ['combobox', 'listbox'].includes(item.role), label: '콤보 상자' },
    KeyT: { test: (item) => item.category === 'table', label: '표' },
    KeyL: { test: (item) => item.category === 'list', label: '목록' },
    KeyG: { test: (item) => item.category === 'graphic', label: '그래픽' },
    KeyD: { test: (item) => item.category === 'landmark', label: '영역' }
  };
  // 조합키(Alt+Shift) 기능 → 서비스 워커가 실행할 기존 AI 기능
  const AI_COMMANDS = { summary: 'summarize-page', ask: 'ask-page', detail: 'read-detail' };
  const AI_TASKS = { 'summarize-page': '페이지 요약', 'read-detail': '상세 이미지 읽기' };
  // 이 요소에 초점이 가면 글쓰기 모드 (키를 페이지에 그대로 넘김)
  const EDITABLE =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),' +
    ' textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]';
  // 화살표 키로 조작하는 위젯: 초점이 가면 NVDA처럼 자동으로 글쓰기 모드 (키를 위젯에 넘김)
  const ARROW_WIDGETS = '[role="slider"], [role="listbox"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="spinbutton"]';
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
  const PENDING_TIMEOUT = 30_000;
  // 글쓰기 모드에서 온글 명령 대신 페이지에 넘기는 조합 (Alt+Shift+↓는 편집창의 문단 단위 선택)
  const FOCUS_MODE_PASS = new Set(['ArrowDown']);
  // 점자에서 알림이 아니라 항목 내용으로 보이는 안내 (첫 항목 이름을 함께 읽음)
  const CONTENT_GUIDES = new Set(['menu-opened', 'list-opened']);

  let enabled = false;
  let generation = 0;
  let items = [];
  let index = -1;
  let focusMode = false;
  let sayingAll = false;
  let stopWatching = null;
  let liveObserver = null;
  let ignoreFocusUntil = 0;
  // 초점이 웹페이지 밖(주소창 등)에 있을 때 받은 명령. F6으로 초점이 돌아오면 이어서 실행한다.
  let pendingOnFocus = null;
  // 초점은 옮겨졌지만 읽기 목록에 따로 없는 요소 (Enter를 누르면 이 요소를 누른다). 읽기 위치를 옮기면 지운다.
  let focusOnly = null;
  // 지금 읽는 범위 (페이지 전체 또는 열린 모달 대화상자)
  let lastRoot = null;
  let settings = ns.mergeReaderSettings();
  let shortcuts = { toggle: '', menu: '', stop: '', reread: '' };

  const output = {
    say: (text, options) => ns.output.say(text, options),
    stop: () => ns.output.stop(),
    focus: (item) => ns.output.focus(item),
    sayAll: (list, onItem) => ns.output.sayAll(list, onItem)
  };

  // 확장이 업데이트·제거되면 chrome.runtime.id가 사라진다
  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get('settings');
    settings = ns.mergeReaderSettings(stored.settings);
    if (enabled) {
      ns.output.setCaptionPosition(settings.reader.captionPosition);
      ns.braille?.refreshAdmin();
    }
    const response = await chrome.runtime.sendMessage({ type: 'ongeul-shortcuts' }).catch(() => null);
    if (response) shortcuts = response;
  }

  // 온글 명령의 실제 키 이름 ("Alt와 Shift와 S"). 기능 키 글자는 설정을 따른다.
  function keyNames() {
    return guidance.keyNames(settings.reader.commandKeys);
  }

  // 안내 문구를 읽는다. 자세히·짧게 판단에 쓰는 "읽은 횟수"는 서비스 워커 한 곳에서 센다(탭끼리 덮어쓰지 않게).
  // dropIfStale: 안내 문장을 받아 오는 사이 다른 문장이 나왔으면 이 안내는 읽지 않는다 (예: 결과가 바로 나와 이미 읽는 중)
  // 안내 문구는 점자에서 잠깐 보여 주는 알림(message)이다. 메뉴·목록이 열렸다는 안내는 첫 항목을 함께 읽으므로 항목 내용으로 둔다.
  async function guide(id, params = {}, { interrupt = false, dropIfStale = false, message = !CONTENT_GUIDES.has(id) } = {}) {
    const before = ns.output.said;
    const fullParams = { ...params, toggle: shortcuts.toggle, menu: shortcuts.menu, keys: keyNames() };
    const response = await chrome.runtime.sendMessage({ type: 'ongeul-guide-text', id, params: fullParams }).catch(() => null);
    const text = response?.text ?? guidance.message(id, fullParams, { verbosity: settings.reader.verbosity, seen: 0 });
    if (dropIfStale && ns.output.said !== before) return { final: 'end', events: [] };
    return output.say(text, { interrupt, message });
  }

  function help() {
    output.say(guidance.help({ ...shortcuts, keys: keyNames() }), { interrupt: true, message: true });
  }

  // 목록을 다시 만든다. 읽던 요소가 사라졌으면 그 앞뒤 항목을 기준으로 가장 가까운 곳에 머문다.
  // 읽는 범위가 바뀌었으면(모달 대화상자가 열리거나 닫힘) true를 돌려준다
  function rebuild() {
    const current = items[index]?.el;
    const before = items.slice(Math.max(0, index - 3), Math.max(0, index)).map((item) => item.el).reverse();
    const after = items.slice(index + 1, index + 4).map((item) => item.el);
    const root = model.readingRoot();
    const rootChanged = lastRoot !== null && root !== lastRoot;
    lastRoot = root;
    items = decorateAll(model.buildItems(root));
    if (rootChanged) {
      // 새 범위에서는 처음부터 (현재 위치는 초점 이동으로 다시 정해진다)
      index = model.indexOfElement(items, current);
      return true;
    }
    if (index < 0) return false;
    if (current?.isConnected) {
      const found = model.indexOfElement(items, current);
      if (found !== -1) {
        index = found;
        return false;
      }
    }
    // 읽던 요소가 사라짐: 뒤쪽 항목이 남아 있으면 그 바로 앞으로(아래 화살표로 그 항목을 읽게), 아니면 앞쪽 항목으로
    const next = after.map((el) => (el.isConnected ? model.indexOfElement(items, el, { exact: true }) : -1)).find((i) => i !== -1);
    if (next !== undefined) {
      index = next - 1;
      return false;
    }
    const prev = before.map((el) => (el.isConnected ? model.indexOfElement(items, el, { exact: true }) : -1)).find((i) => i !== -1);
    index = prev ?? Math.min(index, items.length - 1);
    return false;
  }

  // AI 자동 보완으로 알게 된 이름을 붙인다
  function decorateAll(list) {
    return ns.ai ? list.map((item) => ns.ai.decorate(item)) : list;
  }

  // 모달 대화상자가 열렸을 때 읽을 안내 ("대화상자 제목, 대화상자")
  function dialogPrefix() {
    const root = model.readingRoot();
    return root === document.body ? '' : model.itemFor(root).phrase;
  }

  // 페이지 변화로 목록을 다시 만들 때: 모달 대화상자가 열렸으면 온글 화면을 그 위로 올린다
  function onPageChange() {
    if (!enabled || document.visibilityState !== 'visible') return;
    const rootChanged = rebuild();
    if (model.readingRoot() !== document.body) ns.output.raise?.();
    // 초점을 옮기지 않는 대화상자가 열리면 대화상자 이름을 알리고 그 처음부터 읽게 한다
    if (rootChanged && model.readingRoot() !== document.body && !model.readingRoot().contains(document.activeElement)) {
      index = -1;
      output.say(dialogPrefix(), { interrupt: true, message: true });
    }
  }

  function current() {
    return items[index];
  }

  // 항목으로 읽기 위치를 옮기고 읽는다. 초점을 받을 수 있는 요소는 실제 초점도 옮긴다(누르기 위해).
  function moveTo(nextIndex, { prefix = '' } = {}) {
    if (nextIndex < 0 || nextIndex >= items.length) return false;
    index = nextIndex;
    focusOnly = null;
    let item = items[index];
    if (item.role !== 'text') item = items[index] = model.refreshItem(item);
    item.el.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    if (item.el.matches?.(FOCUSABLE) && !item.el.matches(EDITABLE)) {
      ignoreFocusUntil = performance.now() + 200;
      item.el.focus({ preventScroll: true });
    }
    output.focus(item);
    output.say(prefix ? `${prefix} ${item.phrase}` : item.phrase, { interrupt: true });
    ns.ai?.onItemRead?.(item);
    return true;
  }

  function step(delta) {
    const target = index + delta;
    if (target < 0) return guide('page-start', {}, { interrupt: true });
    if (target >= items.length) return guide('page-end', {}, { interrupt: true });
    moveTo(target);
  }

  function jump(test, backward, label, key) {
    const order = backward ? -1 : 1;
    for (let i = index + order; i >= 0 && i < items.length; i += order) {
      if (test(items[i])) return moveTo(i);
    }
    guide('not-found', { label, key, backward }, { interrupt: true });
  }

  // 누르기: 링크 이동, 버튼, 체크박스. 편집 요소는 글쓰기 모드로 들어간다.
  function activate() {
    const item = current();
    // Tab·클릭으로 초점이 읽기 목록에 따로 없는 요소에 옮겨진 뒤라면 그 요소를 누른다
    const active = document.activeElement;
    if (focusOnly && active === focusOnly && active.isConnected) {
      if (active.matches(EDITABLE)) enterFocusMode(active);
      else active.click();
      return;
    }
    if (!item) return;
    let el = item.el;
    // 제목 안에 링크·버튼이 하나 있으면 그것을 누른다
    if (item.role === 'heading') {
      const inner = el.querySelectorAll('a[href], button');
      if (inner.length === 1) el = inner[0];
    }
    if (el === item.el && (item.role === 'text' || ['list', 'landmark', 'table', 'heading'].includes(item.category))) {
      guide('activate-unavailable', {}, { interrupt: true });
      return;
    }
    if (el.matches?.(EDITABLE)) {
      enterFocusMode(el);
      return;
    }
    el.focus?.({ preventScroll: true });
    el.click?.();
    // 체크박스·전환 버튼처럼 상태가 바뀌는 항목은 바뀐 상태를 읽는다
    setTimeout(() => {
      if (!el.isConnected || !enabled) return;
      const refreshed = model.refreshItem(item);
      if (refreshed.phrase !== item.phrase && items[index]?.el === item.el) {
        items[index] = refreshed;
        output.say(refreshed.states.join(', ') || refreshed.phrase, { interrupt: true });
      }
    }, 150);
  }

  // 글쓰기 모드로 들어간다. 안내에는 실제로 초점이 간 요소의 이름을 쓴다.
  function enterFocusMode(el) {
    focusMode = true;
    const target = el ?? document.activeElement;
    if (el && document.activeElement !== el) {
      ignoreFocusUntil = performance.now() + 200;
      el.focus({ preventScroll: true });
    }
    const field = target && target !== document.body ? model.itemFor(target).phrase : '';
    guide('focus-mode', { field }, { interrupt: false });
  }

  function leaveFocusMode(announce = true) {
    if (!focusMode) return;
    focusMode = false;
    if (announce) guide('browse-mode', {}, { interrupt: true });
  }

  // 계속 읽기: 목록이 중간에 다시 만들어져도 읽는 요소를 기준으로 위치를 다시 찾는다
  // 계속 읽기를 다시 시작하면 앞선 계속 읽기가 늦게 끝나므로, 자기 차례(run)일 때만 "읽는 중" 표시를 끈다
  let sayAllRun = 0;
  async function sayAll(list = items.slice(Math.max(index, 0))) {
    const run = ++sayAllRun;
    sayingAll = true;
    try {
      await output.sayAll(list, (offset) => {
        if (!sayingAll || run !== sayAllRun) return;
        const el = list[offset].el;
        const found = model.indexOfElement(items, el, { exact: true });
        if (found !== -1) index = found;
        output.focus(list[offset]);
        el.scrollIntoView?.({ block: 'center', behavior: 'instant' });
      });
    } finally {
      if (run === sayAllRun) sayingAll = false;
    }
  }

  // 한 요소(AI 결과 상자 등) 안의 항목을 처음부터 끝까지 읽고, 읽기 위치도 그곳으로 옮긴다
  function readElement(el) {
    if (!enabled || !el?.isConnected) return;
    rebuild();
    const start = items.findIndex((item) => item.el === el || el.contains(item.el));
    if (start === -1) return;
    let end = start;
    while (end + 1 < items.length && el.contains(items[end + 1].el)) end++;
    index = start;
    sayAll(items.slice(start, end + 1));
  }

  function stopSpeech() {
    sayingAll = false;
    output.stop();
  }

  function rereadCurrent({ interrupt = true } = {}) {
    const item = current();
    if (item) {
      items[index] = model.refreshItem(item);
      output.focus(items[index]);
      output.say(items[index].phrase, { interrupt });
    } else {
      output.say(pageSummary(), { interrupt });
    }
  }

  // 사용자가 요청한 AI 기능 실행. 결과는 각 기능이 끝나는 대로 바로 읽는다.
  function runAi(command) {
    if (AI_TASKS[command]) guide('ai-requested', { task: AI_TASKS[command] }, { interrupt: true, dropIfStale: true });
    chrome.runtime.sendMessage({ type: 'ongeul-run', command }).catch(() => {});
  }

  // 온글 명령: Alt와 Shift를 누른 채 다른 키 (macOS는 Option과 Shift). 크롬 단축키 4개와 같은 조합이다.
  function isCommandCombo(event) {
    return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
  }

  // 키 처리: 온글이 처리한 키만 페이지로 넘기지 않는다
  function onKeyDown(event) {
    if (!enabled || event.isComposing) return;
    if (!alive()) {
      disable();
      return;
    }
    if (ns.guide?.isOpen) {
      if (ns.guide.handleKey(event)) consume(event);
      else if (event.key === 'Control') stopSpeech();
      return;
    }
    if (ns.menu?.isOpen) {
      if (ns.menu.handleKey(event)) consume(event);
      else if (event.key === 'Control') stopSpeech();
      return;
    }
    if (sayingAll && !['Shift', 'Alt', 'Meta'].includes(event.key)) stopSpeech();

    // 온글 명령은 글쓰기 모드(편집창, 선택 상자 등)에서도 받는다. 명령으로 쓰지 않는 Alt+Shift(Option+Shift) 조합은
    // 페이지에 그대로 넘기므로, macOS에서 명령 글자가 아닌 특수 문자는 계속 입력할 수 있다.
    if (isCommandCombo(event) && !(focusMode && FOCUS_MODE_PASS.has(event.code))) {
      if (handleCommand(event)) {
        consume(event);
        return;
      }
      if (!focusMode) return;
    }
    if (event.key === 'Control') {
      stopSpeech();
      return;
    }
    if (focusMode) {
      if (event.key === 'Escape') {
        consume(event);
        leaveFocusMode();
      }
      return;
    }
    if (handleBrowseKey(event)) consume(event);
  }

  // 초점이 주소창 등에서 웹페이지로 돌아오면(F6) 기다리던 명령을 실행한다 (30초가 지나면 취소)
  function onWindowFocus() {
    if (!pendingOnFocus) return;
    const { action, at } = pendingOnFocus;
    pendingOnFocus = null;
    if (performance.now() - at < PENDING_TIMEOUT) action();
  }

  // 보이지 않던 탭이 보이게 되면 그때 목록을 만든다 (뒤에 있는 탭은 계산하지 않음)
  function onVisibilityChange() {
    if (enabled && document.visibilityState === 'visible') rebuild();
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // event.code(키 위치)로 판단하므로 한글 입력 상태에서도 같은 키로 동작한다.
  // O·X·R은 크롬 단축키가 먼저 받지만, 사용자가 크롬 단축키를 지웠거나 바꿨을 때도 페이지 안에서는 동작하게 한다.
  function handleCommand(event) {
    const keys = settings.reader.commandKeys;
    switch (event.code) {
      // 계속 읽기: ↓, 또는 A (NVDA 노트북 배열과 같음)
      case 'ArrowDown':
      case 'KeyA':
        sayAll();
        return true;
      case 'KeyR':
        rereadCurrent();
        return true;
      case 'KeyX':
        stopSpeech();
        return true;
      case 'KeyO':
        chrome.runtime.sendMessage({ type: 'ongeul-toggle', enabled: false }).catch(() => {});
        return true;
      // 어디서든 글쓰기 모드로 들어가고 나오기 (슬라이더, 사용자 정의 위젯 조작용)
      case 'Space':
        if (focusMode) leaveFocusMode();
        else enterFocusMode(document.activeElement !== document.body ? document.activeElement : null);
        return true;
      case 'Digit1':
        help();
        return true;
      // AI 결과 모음
      case 'KeyI':
        ns.ai?.openResults();
        return true;
      default:
        break;
    }
    if (event.code === keys.explain) {
      ns.ai?.explainCurrent();
      return true;
    }
    if (event.code === keys.menu) {
      ns.menu.openMenu();
      return true;
    }
    for (const [name, command] of Object.entries(AI_COMMANDS)) {
      if (event.code === keys[name]) {
        runAi(command);
        return true;
      }
    }
    return false;
  }

  function handleBrowseKey(event) {
    if (event.altKey || event.metaKey) return false;
    const backward = event.shiftKey;
    if (event.ctrlKey) {
      if (event.code === 'Home') return moveTo(0) || true;
      if (event.code === 'End') return moveTo(items.length - 1) || true;
      return false;
    }
    switch (event.code) {
      case 'ArrowDown':
        step(1);
        return true;
      case 'ArrowUp':
        step(-1);
        return true;
      case 'Enter':
      case 'Space':
      case 'NumpadEnter':
        activate();
        return true;
      default:
        break;
    }
    const level = event.code.match(/^Digit([1-6])$/)?.[1];
    if (level) {
      jump((item) => item.role === 'heading' && item.level === Number(level), backward, `제목 ${level}`, level);
      return true;
    }
    const quick = QUICK_KEYS[event.code];
    if (quick) {
      jump(quick.test, backward, quick.label, event.code.slice(3));
      return true;
    }
    return false;
  }

  // Tab, 마우스 클릭, 페이지 스크립트(AI 결과로 이동 등)로 초점이 옮겨지면 그 요소를 읽는다.
  // 새로 생긴 요소일 수 있으므로 목록을 바로 다시 만들고, 그래도 없으면 그 요소만 따로 읽는다.
  function onFocusIn(event) {
    if (!enabled || performance.now() < ignoreFocusUntil) return;
    const el = event.target;
    if (!(el instanceof Element) || el.closest('[data-ongeul-ui]')) return;
    const rootChanged = rebuild();
    const exact = model.indexOfElement(items, el, { exact: true });
    let item;
    if (exact !== -1) {
      index = exact;
      focusOnly = null;
      item = items[index] = model.refreshItem(items[index]);
    } else {
      // 목록에 따로 없는 요소(글 묶음 안의 요소 등): 가장 가까운 항목에 머물고 초점 요소를 읽는다
      const near = model.indexOfElement(items, el);
      if (near !== -1) index = near;
      focusOnly = el;
      item = ns.ai?.decorate(model.itemFor(el)) ?? model.itemFor(el);
    }
    // 모드를 먼저 바꾼 뒤 읽는다 (자막의 "읽기 모드/글쓰기 모드" 표시가 읽는 항목과 맞도록).
    // 글쓰기 모드 안내는 서비스 워커에서 받아 오므로 항목 이름 뒤에 이어서 읽힌다
    if (el.matches(EDITABLE) || el.matches(ARROW_WIDGETS)) {
      if (!focusMode) enterFocusMode(null);
    } else {
      leaveFocusMode(false);
    }
    output.focus(item);
    // 모달 대화상자가 막 열렸으면 대화상자 이름을 먼저 읽는다
    const prefix = rootChanged ? dialogPrefix() : '';
    output.say(prefix ? `${prefix}, ${item.phrase}` : item.phrase, { interrupt: true });
    ns.ai?.onItemRead?.(item);
  }

  // 실시간 안내 영역(role=status/alert, aria-live)의 새 글을 읽는다.
  // 같은 글을 다시 알리려고 비웠다 채우는 경우와, 안내 영역이 통째로 새로 생기는 경우(토스트 알림)도 읽는다.
  // 일반(polite) 안내는 하나씩 차례로 읽는다. 아직 읽지 않은 안내는 같은 영역의 새 안내로 바꾸고(진행률처럼 자주 바뀌는 안내가
  // 쌓이지 않게), 읽을 차례에 그 영역 글이 이미 바뀌었거나 비었으면 지난 안내이므로 읽지 않는다.
  function watchLiveRegions() {
    const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
    const lastText = new WeakMap();
    const textOf = (region) => region.textContent.replace(/\s+/g, ' ').trim();
    const waiting = [];
    let speaking = false;
    const myGeneration = generation;
    const pump = async () => {
      if (speaking) return;
      speaking = true;
      while (waiting.length && enabled && myGeneration === generation) {
        const { region, text } = waiting.shift();
        if (!region.isConnected || textOf(region) !== text) continue;
        await output.say(text, { interrupt: false, message: true });
      }
      speaking = false;
    };
    const announce = (region) => {
      if (region.closest('[data-ongeul-ui]')) return;
      const text = textOf(region);
      if (!text) {
        lastText.delete(region);
        return;
      }
      if (lastText.get(region) === text) return;
      lastText.set(region, text);
      const assertive = region.getAttribute('aria-live') === 'assertive' || region.getAttribute('role') === 'alert';
      if (assertive) {
        output.say(text, { interrupt: true, message: true });
        return;
      }
      const queued = waiting.find((entry) => entry.region === region);
      if (queued) queued.text = text;
      else waiting.push({ region, text });
      pump();
    };
    liveObserver = new MutationObserver((mutations) => {
      if (!enabled || myGeneration !== generation) return;
      const regions = new Set();
      for (const m of mutations) {
        const target = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
        const region = target?.closest?.(LIVE);
        if (region) regions.add(region);
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches(LIVE)) regions.add(node);
          node.querySelectorAll?.(LIVE).forEach((inner) => regions.add(inner));
        }
      }
      regions.forEach(announce);
    });
    liveObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function pageCounts() {
    const count = (category) => items.filter((item) => item.category === category).length;
    return `제목 ${count('heading')}개, 링크 ${count('link')}개`;
  }

  function pageSummary() {
    return `${document.title || '제목 없는 페이지'}, ${pageCounts()}`;
  }

  // reason: toggle(사용자가 켬) 또는 load(켜진 상태로 페이지가 열림)
  async function enable({ reason = 'load' } = {}) {
    if (enabled || !document.body) return;
    enabled = true;
    const myGeneration = ++generation;
    await loadSettings();
    // 설정을 읽는 사이 꺼졌거나 다시 켜졌으면 여기서 멈춘다 (감시자가 겹쳐 붙지 않게)
    if (!enabled || myGeneration !== generation) return;
    stopWatching?.();
    liveObserver?.disconnect();
    lastRoot = model.readingRoot();
    items = document.visibilityState === 'visible' ? decorateAll(model.buildItems(lastRoot)) : [];
    ns.ai?.prefetch(items);
    index = -1;
    stopWatching = model.watch(onPageChange);
    watchLiveRegions();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    ns.output.show();
    ns.output.setCaptionPosition(settings.reader.captionPosition);
    ns.braille?.refreshAdmin();
    // 보이는 탭만 말한다 (뒤에 있는 탭들이 한꺼번에 말하지 않도록)
    if (document.visibilityState !== 'visible') return;
    if (reason === 'toggle') {
      // 켜기 안내가 점자에서 사라지면 페이지 정보로 돌아가도록
      ns.braille?.setContent?.(pageSummary());
      guide('reader-on', { title: document.title, counts: pageCounts() }, { interrupt: true });
    }
    else output.say(pageSummary(), { interrupt: true });
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    generation++;
    sayingAll = false;
    ns.menu?.close({ announce: false });
    ns.guide?.close();
    stopWatching?.();
    stopWatching = null;
    liveObserver?.disconnect();
    liveObserver = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('focus', onWindowFocus);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    // "온글 꺼짐" 안내는 서비스 워커가 읽으므로 여기서는 음성을 멈추지 않고 화면만 치운다
    ns.output.cancel?.();
    ns.output.hide();
    focusMode = false;
    pendingOnFocus = null;
  }

  // 점자 디스플레이의 커서 이동 버튼: 링크·버튼 같은 조작 요소면 누르고, 그 밖의 항목은 다시 읽는다 (NVDA와 같음)
  function routeCurrent() {
    const item = current();
    if (item && ['link', 'button', 'field'].includes(item.category)) activate();
    else rereadCurrent();
  }

  // 다른 기능(요약의 "원문으로 이동", 제목 목록 등)이 읽기 위치를 옮길 때 쓴다
  function moveToElement(el, prefix) {
    rebuild();
    const found = model.indexOfElement(items, el);
    return found !== -1 && moveTo(found, { prefix });
  }

  // 서비스 워커가 보내는 명령: 크롬 단축키(메뉴, 다시 읽기, 멈춤)와 탭 전환
  function onMessage(message, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id) return;
    switch (message?.type) {
      case 'ongeul-ping':
        sendResponse({ ok: true, enabled });
        return;
      case 'ongeul-tab-activated':
        if (!enabled) return;
        if (!items.length) rebuild();
        output.say(`${document.title}${current() ? `, ${current().phrase}` : ''}`, { interrupt: true });
        sendResponse({ ok: true });
        return;
      case 'ongeul-open-menu':
      case 'ongeul-reread': {
        if (!enabled) {
          sendResponse({ state: 'off' });
          return;
        }
        const isMenu = message.type === 'ongeul-open-menu';
        if (document.hasFocus()) {
          if (isMenu) ns.menu.openMenu();
          else rereadCurrent();
          sendResponse({ state: 'done' });
        } else {
          // 초점이 주소창 등에 있음: 서비스 워커가 F6 안내를 읽고, 초점이 돌아오면 안내에 이어서 실행한다
          pendingOnFocus = {
            at: performance.now(),
            action: () => {
              guide(isMenu ? 'pending-menu' : 'returned-to-page', {}, { interrupt: true });
              if (isMenu) ns.menu.openMenu({ interrupt: false });
              else rereadCurrent({ interrupt: false });
            }
          };
          sendResponse({ state: 'unfocused' });
        }
        return;
      }
      case 'ongeul-stop-all':
        stopSpeech();
        sendResponse({ ok: true });
        return;
      default:
        break;
    }
  }

  chrome.storage.local.get('readerEnabled').then(({ readerEnabled }) => {
    if (readerEnabled) enable({ reason: 'load' });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !alive()) return;
    if (changes.readerEnabled) {
      if (changes.readerEnabled.newValue) enable({ reason: 'toggle' });
      else disable();
    }
    if (changes.settings && enabled) loadSettings();
  });
  chrome.runtime.onMessage.addListener(onMessage);

  ns.reader = {
    get enabled() {
      return enabled;
    },
    get items() {
      return items;
    },
    get index() {
      return index;
    },
    get focusMode() {
      return focusMode;
    },
    get sayingAll() {
      return sayingAll;
    },
    get settings() {
      return settings;
    },
    get shortcuts() {
      return shortcuts;
    },
    alive,
    enable,
    disable,
    rebuild,
    moveTo,
    moveToElement,
    readElement,
    routeCurrent,
    runAi,
    guide,
    help,
    say: (text, options) => output.say(text, options)
  };
})();
