// 온글 출력(R3·R4): 읽은 문장 하나를 화면 오버레이(자막 패널, 현재 위치 테두리)와 음성으로 내보낸다.
// 점자 출력(R5)은 __ongeul.braille이 있으면 같은 문장을 넘긴다.
// 온글 화면은 Shadow DOM으로 분리해 페이지 디자인과 섞이지 않게 하고, data-ongeul-ui로 읽기 대상에서 뺀다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.output) return;

  const STYLE = `
    :host { all: initial; }
    .caption {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      box-sizing: border-box; width: min(960px, calc(100vw - 32px)); max-height: 40vh; overflow: auto;
      padding: 14px 20px; border-radius: 10px; background: rgba(17, 17, 17, 0.92); color: #fff;
      font: 600 22px/1.5 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35); z-index: 2147483646; pointer-events: none;
      white-space: pre-wrap; word-break: keep-all;
    }
    .caption.top { top: 24px; bottom: auto; }
    .caption[hidden] { display: none; }
    .caption .mode { display: block; font-size: 14px; font-weight: 500; color: #cbd5e1; margin-bottom: 4px; }
    .ring {
      position: fixed; box-sizing: border-box; border: 4px solid #f59e0b; border-radius: 6px;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6); pointer-events: none; z-index: 2147483645;
    }
    .ring[hidden] { display: none; }
  `;

  let host = null;
  let root = null;
  let caption = null;
  let captionMode = null;
  let captionText = null;
  let ring = null;
  let ringTarget = null;
  let ringFrame = 0;
  let ringObserver = null;
  let sequence = 0;

  // 온글 화면을 담을 곳 (메뉴, 가상 점자 디스플레이도 이곳에 붙는다)
  function ui() {
    if (root?.host.isConnected) return root;
    host = document.createElement('div');
    host.setAttribute('data-ongeul-ui', '');
    // 온글이 직접 읽어 주므로 다른 보조기술에는 숨긴다
    host.setAttribute('aria-hidden', 'true');
    // 페이지의 모달 대화상자(top layer)보다 위에 그리도록 popover로 top layer에 올린다.
    // popover 기본 스타일(가운데 정렬, 테두리, 배경)은 지우고 크기 없는 투명 상자로 둔다.
    host.setAttribute('popover', 'manual');
    host.style.cssText =
      'position:fixed;inset:0;width:0;height:0;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    caption = document.createElement('div');
    caption.className = 'caption';
    caption.hidden = true;
    captionMode = document.createElement('span');
    captionMode.className = 'mode';
    captionText = document.createElement('span');
    caption.append(captionMode, captionText);
    ring = document.createElement('div');
    ring.className = 'ring';
    ring.hidden = true;
    root.append(style, ring, caption);
    document.documentElement.append(host);
    raise();
    window.addEventListener('scroll', scheduleRing, { capture: true, passive: true });
    window.addEventListener('resize', scheduleRing, { passive: true });
    return root;
  }

  // 온글 화면을 top layer 맨 위로 (나중에 열린 모달 대화상자 위로 다시 올림)
  function raise() {
    if (!host?.isConnected || typeof host.showPopover !== 'function') return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {
      // popover를 지원하지 않는 환경에서는 일반 요소로 둔다
    }
  }

  function addStyle(css) {
    const style = document.createElement('style');
    style.textContent = css;
    ui().append(style);
  }

  function setCaption(text) {
    ui();
    caption.hidden = false;
    captionMode.textContent = ns.reader?.focusMode ? '온글 · 글쓰기 모드' : '온글 · 읽기 모드';
    captionText.textContent = text;
  }

  // 현재 위치 테두리: 스크롤, 창 크기, 요소 크기가 바뀔 때만 위치를 다시 잡는다 (매 프레임 계산하지 않음)
  function updateRing() {
    ringFrame = 0;
    if (!ring) return;
    if (!ringTarget?.isConnected) {
      ring.hidden = true;
      return;
    }
    const rect = ringTarget.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      ring.hidden = true;
      return;
    }
    ring.hidden = false;
    Object.assign(ring.style, {
      left: `${rect.left - 6}px`,
      top: `${rect.top - 6}px`,
      width: `${rect.width + 12}px`,
      height: `${rect.height + 12}px`
    });
  }

  function scheduleRing() {
    if (!ringFrame) ringFrame = requestAnimationFrame(updateRing);
  }

  function trackRing() {
    ringObserver?.disconnect();
    if (ringTarget && typeof ResizeObserver === 'function') {
      ringObserver = new ResizeObserver(scheduleRing);
      ringObserver.observe(ringTarget);
    }
    scheduleRing();
  }

  // 문장 하나를 화면·음성·점자로 내보낸다. 음성이 끝나거나 끊기면 결과를 돌려준다.
  // interrupt: true면 읽던 것을 끊고 읽음(이동할 때), false면 앞 문장 뒤에 이어 읽음(안내, 실시간 알림).
  // 이어 읽는 문장은 자막·점자에서 앞 문장을 지우지 않고 뒤에 붙인다 (점자 사용자가 항목 이름을 잃지 않게).
  // 이어 읽는 문장은 계속 읽기를 멈추지 않는다 (끊는 문장과 멈춤만 계속 읽기를 멈춤).
  const MAX_CAPTION = 600;
  let said = 0;
  function say(text, { interrupt = true, append = !interrupt, ownSequence = false } = {}) {
    if (!text) return Promise.resolve({ final: 'end', events: [] });
    said++;
    if (interrupt && !ownSequence) sequence++;
    const id = sequence;
    const previous = captionText?.textContent ?? '';
    const shown = append && previous && !caption?.hidden ? `${previous} ${text}`.slice(-MAX_CAPTION) : text;
    setCaption(shown);
    ns.braille?.write?.(shown);
    return chrome.runtime
      .sendMessage({ type: 'ongeul-say', text, interrupt })
      .then((result) => ({ ...result, id }))
      .catch((error) => ({ final: 'error', error: error.message, id, events: [] }));
  }

  function stop() {
    sequence++;
    chrome.runtime.sendMessage({ type: 'ongeul-stop' }).catch(() => {});
  }

  function focus(item) {
    ui();
    ringTarget = item?.el ?? null;
    trackRing();
  }

  // 계속 읽기: 항목을 하나씩 읽고, 다음 항목으로 넘어갈 때마다 onItem(순서)을 부른다.
  // 다른 문장이 끼어들거나(이동, 멈춤) 읽기가 끊기면 멈춘다.
  async function sayAll(list, onItem) {
    const token = ++sequence;
    for (let i = 0; i < list.length; i++) {
      if (sequence !== token) return;
      onItem?.(i);
      const result = await say(list[i].phrase, { interrupt: i === 0, append: false, ownSequence: true });
      if (result.final !== 'end' || sequence !== token) return;
    }
  }

  function show() {
    ui();
  }

  function hide() {
    cancelAnimationFrame(ringFrame);
    ringFrame = 0;
    ringObserver?.disconnect();
    window.removeEventListener('scroll', scheduleRing, { capture: true });
    window.removeEventListener('resize', scheduleRing);
    host?.remove();
    root = null;
    ringTarget = null;
  }

  // 읽기 중인 음성만 멈추고 서비스 워커에는 알리지 않는다 (서비스 워커가 다른 안내를 읽는 중일 때)
  function cancel() {
    sequence++;
  }

  function setCaptionPosition(position) {
    ui();
    caption.classList.toggle('top', position === 'top');
  }

  ns.output = {
    say, stop, cancel, focus, sayAll, show, hide, ui, addStyle, setCaptionPosition, raise, scheduleRing,
    // 지금까지 내보낸 문장 수 (늦게 도착한 안내가 그 사이 나온 문장을 끊지 않게 할 때 씀)
    get said() {
      return said;
    }
  };
})();
