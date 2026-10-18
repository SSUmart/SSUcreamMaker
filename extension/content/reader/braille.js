// 점자 출력(R5)과 점자 전달 테스트(T1, 관리자 도구).
// 온글이 읽은 글 → 한국 점자 칸(hangul-braille.js) → 디스플레이 칸 수만큼 한 줄씩 → 전송 계층 → 점자 디스플레이.
// 이 프로젝트는 실제 기기 대신 가상 점자 디스플레이로 받는다. 실제 기기를 쓸 때는 전송 계층(transport)만 바꾸면 된다
// (기기 종류별 설계는 docs/BRAILLE-DEVICES.md). 가상 기기와 결과 패널은 관리자 도구를 켜고 버튼을 눌렀을 때만 보인다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.braille) return;
  const { hangulBraille } = ns;

  const STYLE = `
    .braille-toggle {
      position: fixed; right: 16px; bottom: 24px; z-index: 2147483647; pointer-events: auto;
      padding: 8px 14px; border-radius: 8px; border: 2px solid #7c3aed; background: #fff; color: #5b21b6;
      font: 600 15px/1.4 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    }
    .braille-toggle[hidden], .braille-panel[hidden] { display: none; }
    .braille-panel {
      position: fixed; right: 16px; top: 16px; z-index: 2147483647; pointer-events: auto;
      box-sizing: border-box; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 140px); overflow: auto;
      padding: 14px 16px; border-radius: 12px; background: #fff; color: #111; border: 3px solid #7c3aed;
      font: 14px/1.5 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
    }
    .braille-panel h2 { margin: 0 0 4px; font-size: 18px; }
    .braille-panel .sub { margin: 0 0 10px; color: #4b5563; }
    .braille-panel .close { position: absolute; right: 12px; top: 10px; }
    .braille-panel button { font: inherit; cursor: pointer; }
    .device { background: #1f2937; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
    .cells { display: flex; flex-wrap: wrap; gap: 2px; }
    .cellbox { display: flex; flex-direction: column; align-items: center; }
    .cellbox .pins { color: #f9fafb; font-size: 26px; line-height: 1.1; min-width: 18px; text-align: center; }
    .cellbox button { width: 14px; height: 10px; padding: 0; margin-top: 2px; border: 0; border-radius: 2px; background: #9ca3af; }
    .cellbox button:hover, .cellbox button:focus-visible { background: #fbbf24; }
    .device .controls { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; color: #e5e7eb; }
    .device .controls button { padding: 2px 10px; border-radius: 6px; border: 1px solid #9ca3af; background: #374151; color: #f9fafb; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { width: 84px; background: #f3f4f6; font-weight: 600; white-space: nowrap; }
    td { overflow-wrap: anywhere; word-break: break-all; }
    .ok { color: #166534; font-weight: 700; }
    .bad { color: #b91c1c; font-weight: 700; }
    .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
    .unicode { font-size: 20px; letter-spacing: 1px; }
  `;

  // 기기 상태(전송 계층이 바뀌어도 그대로)
  const state = {
    text: '',
    translation: { cells: [], source: [], unknown: [] },
    lines: [],
    line: 0,
    frame: [],
    lastWrite: null,
    lastInput: null,
    writes: 0
  };

  // ---- 전송 계층: 가상 점자 디스플레이 ----
  // 실제 기기 전송 계층도 같은 모양(name, cells, connected, write, onInput)으로 만들면 나머지는 바꾸지 않아도 된다.
  const virtualTransport = {
    name: '가상 점자 디스플레이',
    kind: '가상 기기 (온글 안에서 동작)',
    connected: true,
    get cells() {
      return settings().cells;
    },
    // 칸 데이터(바이트 배열)를 기기에 쓴다. 실제 기기라면 WebHID sendReport 등이 여기에 들어간다.
    async write(bytes) {
      const started = performance.now();
      if (bytes.length !== this.cells) throw new Error(`칸 수가 맞지 않습니다 (보낸 ${bytes.length}칸, 기기 ${this.cells}칸)`);
      if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error('칸 값은 0~255여야 합니다');
      state.frame = [...bytes];
      renderDevice();
      return { ok: true, ms: performance.now() - started };
    },
    inputHandlers: [],
    onInput(handler) {
      this.inputHandlers.push(handler);
    },
    // 가상 기기의 버튼을 누르면 기기 → 스크린리더 방향 신호를 보낸다 (실제 기기의 입력 보고서에 해당)
    press(event) {
      this.inputHandlers.forEach((handler) => handler(event));
    }
  };
  const transport = virtualTransport;

  function settings() {
    const braille = ns.reader?.settings?.braille ?? ns.defaults?.braille ?? {};
    return { grade: braille.grade ?? 2, cells: braille.cells ?? 40, adminTools: Boolean(braille.adminTools) };
  }

  // 칸 배열을 디스플레이 한 줄(칸 수)씩 나눈다. 가능하면 낱말 사이(빈칸)에서 끊는다.
  function splitLines(cellList, width) {
    const lines = [];
    let start = 0;
    while (start < cellList.length) {
      let end = Math.min(start + width, cellList.length);
      if (end < cellList.length) {
        const space = cellList.lastIndexOf(0, end - 1);
        if (space > start) end = space + 1;
      }
      lines.push({ start, end });
      start = end;
      while (cellList[start] === 0 && start < cellList.length) start++;
    }
    return lines.length ? lines : [{ start: 0, end: 0 }];
  }

  // 지금 줄을 기기 칸 수에 맞춰(남는 칸은 빈칸) 보낸다
  async function sendLine() {
    const width = transport.cells;
    const { start, end } = state.lines[state.line] ?? { start: 0, end: 0 };
    const bytes = state.translation.cells.slice(start, end);
    while (bytes.length < width) bytes.push(0);
    const at = new Date();
    try {
      const result = await transport.write(bytes);
      state.lastWrite = { ok: true, ms: result.ms, at, bytes };
    } catch (error) {
      state.lastWrite = { ok: false, error: error.message, at, bytes };
    }
    state.writes++;
    renderPanel();
  }

  function setText(text) {
    state.text = text ?? '';
    state.translation = hangulBraille.translate(state.text, { grade: settings().grade });
    state.lines = splitLines(state.translation.cells, transport.cells);
    state.line = 0;
  }

  // ---- 점자 알림 (NVDA의 점자 메시지와 같은 방식) ----
  // 안내 문구·페이지 알림은 디스플레이에 잠깐(4초) 보여 준 뒤, 그 전에 읽던 항목과 읽던 줄로 돌아간다.
  // 알림이 길면 줄 넘기기로 알림 안을 읽고(누를 때마다 4초를 다시 셈), 커서 이동 버튼은 알림을 닫고 돌아간다.
  // 항목 내용(이동한 항목, 계속 읽기, 메뉴 항목 등)이 새로 오면 알림은 바로 끝나고 새 내용을 보인다.
  const MESSAGE_MS = 4000;
  let message = null; // { saved: 알림 전 상태, timer }
  const snapshot = () => ({ text: state.text, translation: state.translation, lines: state.lines, line: state.line });

  function startMessageTimer() {
    clearTimeout(message.timer);
    message.timer = setTimeout(() => endMessage({ restore: true }), MESSAGE_MS);
  }

  function endMessage({ restore }) {
    if (!message) return false;
    clearTimeout(message.timer);
    const { saved } = message;
    message = null;
    if (restore) {
      Object.assign(state, saved);
      sendLine();
    }
    return true;
  }

  // 항목 내용을 점자로 보낸다 (output.say가 부른다)
  function write(text) {
    endMessage({ restore: false });
    setText(text);
    return sendLine();
  }

  // 알림을 잠깐 보인다. 알림이 이어서 오면 새 알림으로 바꾸고, 돌아갈 곳은 처음 알림 전 내용 그대로 둔다
  function flash(text) {
    if (!message) message = { saved: snapshot(), timer: 0 };
    setText(text);
    startMessageTimer();
    return sendLine();
  }

  // 알림이 끝나면 돌아갈 항목 내용을 바꾼다 (메뉴를 닫으면 메뉴 항목 대신 읽던 위치로 돌아가도록)
  function setContent(text) {
    if (!message) return write(text);
    const current = snapshot();
    setText(text);
    message.saved = snapshot();
    Object.assign(state, current);
    return undefined;
  }

  // 칸 수·점자 규칙 설정이 바뀌면 지금 글(과 알림이 끝나면 돌아갈 글)을 새 설정으로 다시 나눈다.
  // 읽던 줄은 그 줄의 첫 글자가 들어 있는 새 줄로 옮긴다 (칸 수가 달라도 같은 글자부터 읽도록)
  let layout = '';
  function relayout(view) {
    const firstChar = view.translation.source[view.lines[view.line]?.start] ?? 0;
    const translation = hangulBraille.translate(view.text, { grade: settings().grade });
    const lines = splitLines(translation.cells, transport.cells);
    const at = translation.source.findIndex((charIndex) => charIndex >= firstChar);
    const line = at === -1 ? 0 : Math.max(0, lines.findIndex((l) => at >= l.start && at < Math.max(l.end, l.start + 1)));
    return { text: view.text, translation, lines, line };
  }

  function refreshLayout() {
    const now = `${settings().cells}/${settings().grade}`;
    if (now === layout) return;
    const first = !layout;
    layout = now;
    if (first || !state.lines.length) return;
    if (message) message.saved = relayout(message.saved);
    Object.assign(state, relayout(snapshot()));
    sendLine();
  }

  function pan(delta) {
    const next = state.line + delta;
    if (next < 0 || next >= state.lines.length) return false;
    state.line = next;
    if (message) startMessageTimer();
    sendLine();
    return true;
  }

  // 기기에서 온 신호 처리: 줄 넘기기, 커서 이동 버튼
  transport.onInput((event) => {
    state.lastInput = { ...event, at: new Date() };
    if (event.type === 'pan') pan(event.direction);
    if (event.type === 'routing') {
      // 알림이 떠 있으면 알림만 닫고 읽던 줄로 돌아간다
      if (endMessage({ restore: true })) {
        renderPanel();
        return;
      }
      // NVDA처럼: 커서 이동 버튼으로 링크·버튼을 누르고, 그 밖의 항목은 다시 읽는다
      ns.reader?.routeCurrent?.();
    }
    renderPanel();
  });

  // ---- 화면: 관리자 버튼, 가상 기기, 결과 패널 ----
  let toggleButton = null;
  let panel = null;
  let deviceEl = null;
  let tableEl = null;
  let panelOpen = false;

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function ensureUi() {
    const root = ns.output?.ui?.();
    if (!root) return false;
    if (toggleButton?.isConnected) return true;
    // 온글을 껐다 켜면 화면이 새로 만들어지므로 패널도 닫힌 상태에서 다시 만든다
    panelOpen = false;
    ns.output.addStyle(STYLE);
    toggleButton = el('button', { type: 'button', className: 'braille-toggle' }, '점자 전달 테스트');
    toggleButton.addEventListener('click', togglePanel);
    panel = el('section', { className: 'braille-panel' });
    panel.hidden = true;
    const close = el('button', { type: 'button', className: 'close' }, '닫기');
    close.addEventListener('click', togglePanel);
    deviceEl = el('div', { className: 'device' });
    tableEl = el('table');
    panel.append(
      el('h2', {}, '점자 전달 테스트 (관리자 도구)'),
      el('p', { className: 'sub' }, '온글이 읽은 글이 점자 디스플레이로 어떻게 전달되는지 보여 줍니다. 아래는 실제 기기 대신 데이터를 받는 가상 점자 디스플레이입니다.'),
      close,
      deviceEl,
      tableEl
    );
    root.append(toggleButton, panel);
    return true;
  }

  // 관리자 도구가 켜져 있을 때만 버튼을 보인다 (온글이 켜질 때와 설정이 바뀔 때 부름)
  function refreshAdmin() {
    refreshLayout();
    if (!ensureUi()) return;
    const admin = settings().adminTools;
    toggleButton.hidden = !admin;
    if (!admin && panelOpen) togglePanel();
  }

  function togglePanel() {
    if (!ensureUi()) return;
    panelOpen = !panelOpen;
    panel.hidden = !panelOpen;
    toggleButton.textContent = panelOpen ? '점자 전달 테스트 닫기' : '점자 전달 테스트';
    if (panelOpen) {
      renderDevice();
      renderPanel();
    }
  }

  function renderDevice() {
    if (!panelOpen || !deviceEl) return;
    const width = transport.cells;
    const cellsEl = el('div', { className: 'cells' });
    for (let i = 0; i < width; i++) {
      const value = state.frame[i] ?? 0;
      const box = el('div', { className: 'cellbox' });
      const pins = el('span', { className: 'pins', title: `${i + 1}번 칸: ${hangulBraille.dotNumbers(value)}` }, String.fromCodePoint(0x2800 + value));
      const routing = el('button', { type: 'button', title: `${i + 1}번 칸 커서 이동 버튼` });
      routing.addEventListener('click', () => transport.press({ type: 'routing', cell: i + 1 }));
      box.append(pins, routing);
      cellsEl.append(box);
    }
    const prev = el('button', { type: 'button' }, '◀ 이전 줄');
    prev.addEventListener('click', () => transport.press({ type: 'pan', direction: -1 }));
    const next = el('button', { type: 'button' }, '다음 줄 ▶');
    next.addEventListener('click', () => transport.press({ type: 'pan', direction: 1 }));
    const position = el('span', {}, `${state.lines.length ? state.line + 1 : 0} / ${state.lines.length}줄 · ${width}칸`);
    const controls = el('div', { className: 'controls' });
    controls.append(prev, position, next);
    deviceEl.replaceChildren(cellsEl, controls);
  }

  function row(label, ...content) {
    const tr = el('tr');
    const td = el('td');
    td.append(...content);
    tr.append(el('th', { scope: 'row' }, label), td);
    return tr;
  }

  function renderPanel() {
    if (!panelOpen || !tableEl) return;
    const { grade, cells } = settings();
    const line = state.lines[state.line] ?? { start: 0, end: 0 };
    const lineCells = state.translation.cells.slice(line.start, line.end);
    const sourceChars = [...state.text];
    const lineSource = lineCells.length
      ? sourceChars.slice(state.translation.source[line.start], (state.translation.source[line.end - 1] ?? 0) + 1).join('')
      : '';
    const w = state.lastWrite;
    const time = (d) => d?.toLocaleTimeString('ko-KR', { hour12: false }) ?? '';
    const result = w
      ? el('span', { className: w.ok ? 'ok' : 'bad' }, w.ok
        ? `성공: 기기가 ${w.bytes.length}칸을 받음 (${w.ms.toFixed(2)}ms, ${time(w.at)}, 누적 ${state.writes}번)`
        : `실패: ${w.error} (${time(w.at)})`)
      : el('span', {}, '아직 보낸 글이 없습니다');
    const input = state.lastInput
      ? el('span', { className: 'ok' }, `기기 신호 받음: ${state.lastInput.type === 'routing' ? `${state.lastInput.cell}번 칸 커서 이동 버튼` : state.lastInput.direction > 0 ? '다음 줄 버튼' : '이전 줄 버튼'} (${time(state.lastInput.at)})`)
      : el('span', {}, '가상 기기의 점자 칸 아래 작은 버튼(커서 이동 버튼)이나 줄 넘기기 버튼을 눌러 보세요. 기기에서 온 신호를 받으면 여기에 표시됩니다.');
    const bytes = w?.bytes ?? [];
    tableEl.replaceChildren(
      row('기기 상태', el('span', {}, `${transport.connected ? '연결됨' : '연결 안 됨'} · ${transport.name} (${transport.kind}) · ${cells}칸 · ${grade === 1 ? '1종(약자 없음)' : '2종(약자 사용)'}`)),
      row('보낸 원문', el('span', {}, state.text || '(없음)'), el('br'), el('span', { className: 'sub' }, `지금 줄의 원문: ${lineSource || '(없음)'}`)),
      row('변환 결과', el('span', { className: 'unicode' }, hangulBraille.toUnicode(lineCells) || '(없음)'), el('br'),
        el('span', { className: 'mono' }, lineCells.map((v, i) => `${i + 1}:${hangulBraille.dotNumbers(v)}`).join('  '))),
      row('보낸 데이터', el('span', { className: 'mono' }, bytes.length ? `${bytes.length}바이트 [${bytes.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}]` : '(없음)')),
      row('전송 결과', result),
      row('왕복 확인', input),
      ...(state.translation.unknown.length ? [row('바꾸지 못한 글자', el('span', { className: 'bad' }, [...new Set(state.translation.unknown)].join(' ')))] : [])
    );
  }

  // 온글 메뉴에 "점자 전달 테스트" 항목 (관리자 도구가 켜져 있을 때만)
  (ns.menuExtensions ??= []).push(() =>
    settings().adminTools ? [{ label: panelOpen ? '점자 전달 테스트 닫기 (관리자)' : '점자 전달 테스트 (관리자)', action: togglePanel }] : []
  );

  ns.braille = {
    write,
    flash,
    setContent,
    // 온글을 끌 때 남은 알림 타이머를 지운다
    clearMessage: () => endMessage({ restore: false }),
    get showingMessage() {
      return Boolean(message);
    },
    pan,
    refreshAdmin,
    togglePanel,
    get state() {
      return state;
    },
    get transport() {
      return transport;
    },
    splitLines
  };
})();
