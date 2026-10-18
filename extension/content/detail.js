// F2 상세 이미지 읽기: 아이콘 클릭이나 단축키로 주입된다(page-text.js 다음). 다시 주입되면 이미 정의된 run만 다시 실행한다.
(() => {
  if (window.__ssucreamDetail) {
    window.__ssucreamDetail();
    return;
  }

  // 화면에는 보이지 않고 스크린리더만 읽는 스타일 (진행 안내 영역)
  const SR_ONLY =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
    'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'ec-data-src'];
  const MAX_IMAGES = 60;
  const MIN_RENDERED_WIDTH = 300;
  let busy = false;

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

  // 진행 상태(running, done, error). 평가 도구가 끝났는지 판단할 때 쓴다.
  function setState(state) {
    statusRegion().dataset.state = state;
  }

  // 요약·질문 대화상자가 열려 있는지 (열려 있는 동안은 대화상자가 우선이라 진행 안내를 읽지 않는다)
  const openDialog = () => document.querySelector('dialog[open][id^="ssucream-"]');

  // 끝났다·실패했다는 안내: 대화상자가 열려 있어도 들리도록 온글이 켜져 있으면 온글이 이어서 읽고,
  // 꺼져 있으면 대화상자 안의 안내 영역으로 알린다 (대화상자가 열려 있으면 바깥 안내 영역은 다른 스크린리더에 보이지 않음)
  function notify(text) {
    const dialog = openDialog();
    const reader = globalThis.__ongeul?.reader;
    if (dialog && reader?.enabled) reader.say(text, { interrupt: false, message: true });
    else if (dialog?.ssucreamAnnounce) dialog.ssucreamAnnounce(text);
    else announce(text);
  }

  let announceTimer = null;
  function announce(text) {
    const region = statusRegion();
    // 같은 문장도 다시 읽히도록 비운 뒤 채운다.
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (region.textContent = text), 100);
  }

  function imageUrl(img) {
    for (const attr of LAZY_ATTRS) {
      const value = img.getAttribute(attr);
      if (value && !value.startsWith('data:')) return new URL(value, document.baseURI).href;
    }
    const src = img.currentSrc || img.src;
    return src && !src.startsWith('data:') ? src : null;
  }

  // 문서 순서대로 후보 이미지를 모은다. 정확한 판별은 서비스 워커가 실제 크기로 한다.
  function collectImages() {
    const found = new Map();
    for (const img of document.images) {
      if (img.closest('header, nav, footer, #ssucream-detail')) continue;
      const width = img.getBoundingClientRect().width;
      if (width > 0 && width < MIN_RENDERED_WIDTH) continue;
      const url = imageUrl(img);
      if (!url || found.has(url)) continue;
      found.set(url, img);
      if (found.size >= MAX_IMAGES) break;
    }
    return found;
  }

  // 숨기기·보이기. 사이트 CSS(section{display:block} 등)가 hidden 속성을 덮을 수 있어 display도 직접 바꾼다
  function setShown(node, shown) {
    node.hidden = !shown;
    if (shown) node.style.removeProperty('display');
    else node.style.setProperty('display', 'none', 'important');
  }

  function el(tag, text, style) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }

  // 결과 상자: 첫 상세 이미지 바로 앞에 요약 상자와 같은 모양으로 보여 준다 (눈으로 보는 사용자·보호자·테스터도 확인).
  // 스크린리더는 제목(h2)과 소제목(h3)·목록으로 읽는다. 접기/펼치기, 닫기 버튼이 있고, 닫아도 AI 결과 모음과
  // 상세 이미지 읽기 명령으로 AI를 다시 부르지 않고 다시 연다.
  function render(result, images) {
    const { STYLE } = window.__ssucreamPage;
    document.getElementById('ssucream-detail')?.remove();

    // display를 지정하면 hidden(닫기)이 먹지 않으므로 빼고(section은 원래 블록), 본문 안에 자리 잡는 상자라
    // 사이트의 고정 메뉴·탭 위로 올라가지 않게 쌓임 순서(z-index)도 뺀다
    const section = el('section', null, STYLE.box.replace('display:block;', '').replace('position:relative;z-index:2147483000;', '') +
        // 제목으로 스크롤할 때 사이트의 고정 머리말·탭에 가리지 않게 위쪽 여백을 둔다
        'scroll-margin-top:120px;');
    section.id = 'ssucream-detail';
    section.setAttribute('aria-labelledby', 'ssucream-detail-title');

    const title = el('h2', '상세 이미지 내용, AI 추출', STYLE.heading);
    title.id = 'ssucream-detail-title';
    title.tabIndex = -1;

    const content = el('div');
    content.id = 'ssucream-detail-content';
    let note = `상세 이미지 ${result.imageCount}개에서 AI가 읽은 내용입니다. 틀릴 수 있으니 가격 같은 중요한 정보는 판매자에게 확인하세요.`;
    if (result.truncated) note += ' 이미지가 많아 앞부분만 읽었습니다.';
    if (result.failedCount) note += ` 이미지 ${result.failedCount}개는 가져오지 못했습니다.`;
    content.append(el('p', note, STYLE.note));
    if (!result.sections.length) content.append(el('p', '이미지에서 읽을 글자를 찾지 못했습니다.', STYLE.text));
    for (const { title: heading, items } of result.sections) {
      const list = el('ul', null, STYLE.list);
      for (const item of items) list.append(el('li', item));
      content.append(el('h3', heading, 'margin:12px 0 4px;font-size:17px;font-weight:700;color:#111;'), list);
    }

    const fold = el('button', '접기', STYLE.button);
    fold.type = 'button';
    fold.setAttribute('aria-expanded', 'true');
    fold.setAttribute('aria-controls', content.id);
    fold.addEventListener('click', () => setExpanded(content.hidden));
    const close = el('button', '닫기', STYLE.button);
    close.type = 'button';
    close.addEventListener('click', () => closeBox());
    const toolbar = el('p', null, 'margin:0 0 8px;');
    toolbar.append(fold, close);
    section.append(title, toolbar, content);

    function setExpanded(expanded) {
      setShown(content, expanded);
      fold.textContent = expanded ? '접기' : '펼치기';
      fold.setAttribute('aria-expanded', String(expanded));
    }

    const anchor = images.get(result.firstUrl);
    if (anchor) (anchor.closest('a') ?? anchor).before(section);
    else document.body.prepend(section);

    // 닫으면 상자를 숨기고 읽기 위치를 상세 이미지 자리로 옮긴다 (그 자리에서 다시 여는 방법을 읽음)
    function closeBox() {
      setShown(section, false);
      const reader = globalThis.__ongeul?.reader;
      const moved = reader?.enabled && anchor?.isConnected && reader.moveToElement(anchor, '상세 이미지 내용을 닫았습니다.');
      if (!moved) announce('상세 이미지 내용을 닫았습니다. 상세 이미지 읽기를 다시 실행하면 다시 열립니다.');
    }

    // 닫거나 접어 둔 상자를 읽지 않고 펼치기만 한다 (요약의 "원문으로 이동"이 상자 안을 가리킬 때)
    section.ssucreamShow = () => {
      setShown(section, true);
      setExpanded(true);
    };

    // 다시 열기: 펼친 상태로 보여 주고 처음부터 읽는다
    function reopen() {
      section.ssucreamShow();
      section.scrollIntoView({ block: 'start' });
      title.focus({ preventScroll: true });
      readResult(section);
    }
    section.ssucreamReopen = reopen;

    setState('done');
    globalThis.__ongeul?.ai?.addResult({ kind: 'detail', title: `상세 이미지 내용, ${result.sections.length}개 항목`, el: section, open: reopen });
    const showResult = () => {
      section.scrollIntoView({ block: 'start' });
      title.focus({ preventScroll: true });
      readResult(section);
    };
    // 요약·질문 대화상자가 열려 있으면 닫지 않고 끝났다는 것만 알린다. 사용자가 대화상자를 닫으면 그때 결과를 읽는다.
    // 원문·근거 위치로 이동하며 닫았으면 사용자가 고른 위치를 그대로 두고, 결과를 들을 곳만 알려 준다.
    const dialog = openDialog();
    if (!dialog) {
      showResult();
      return;
    }
    notify('상세 이미지 읽기가 끝났습니다. 대화상자를 닫으면 결과를 읽어 드립니다.');
    dialog.addEventListener(
      'close',
      () => {
        if (!dialog.dataset.closedToSource) {
          showResult();
          return;
        }
        const keys = globalThis.__ongeul?.guidance?.keyNames?.(globalThis.__ongeul?.reader?.settings?.reader?.commandKeys);
        const text = `상세 이미지 읽기 결과는 ${keys?.results ?? 'Alt와 Shift와 I'} 키를 누르면 AI 결과 모음에서 들을 수 있습니다.`;
        const reader = globalThis.__ongeul?.reader;
        if (reader?.enabled) reader.say(text, { interrupt: false, message: true });
        else announce(text);
      },
      { once: true }
    );
  }

  // 온글 스크린리더가 켜져 있으면 추출한 내용을 처음부터 끝까지 바로 읽고, 아니면 안내 영역으로 알린다
  function readResult(section) {
    const reader = globalThis.__ongeul?.reader;
    if (reader?.enabled) {
      // 끝난 진행 안내("읽은 내용 정리 중" 등)가 결과 읽기 사이에 끼지 않게 지운다
      clearTimeout(announceTimer);
      statusRegion().textContent = '';
      reader.readElement(section);
    } else announce('완료. 상세 이미지 내용으로 이동했습니다.');
  }

  async function run() {
    if (busy) {
      announce('이미 상세 이미지를 읽는 중입니다.');
      return;
    }
    // 이미 읽은 결과를 닫아 두었으면 AI를 다시 부르지 않고 다시 연다
    const existing = document.getElementById('ssucream-detail');
    if (existing?.hidden && existing.ssucreamReopen) {
      existing.ssucreamReopen();
      return;
    }
    busy = true;
    setState('running');
    const fail = (text) => {
      setState('error');
      notify(text);
    };
    try {
      const images = collectImages();
      if (!images.size) {
        fail('이 페이지에서 이미지를 찾지 못했습니다.');
        return;
      }
      if (!openDialog()) announce('상세 이미지를 찾는 중입니다.');
      const result = await chrome.runtime.sendMessage({ type: 'extract-detail', urls: [...images.keys()] });
      if (result?.error) fail(result.error);
      else render(result, images);
    } catch (error) {
      fail(window.__ssucreamPage.friendlyError(error));
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    // 끝난 작업의 늦은 진행 안내는 무시한다 (오류·결과 안내를 덮지 않도록).
    // 요약·질문 대화상자가 열려 있으면 진행 안내는 읽지 않는다 (대화상자를 읽는 중에 끼어들지 않게)
    if (message?.type === 'progress' && message.task === 'extract-detail' && busy && !openDialog()) announce(message.text);
  });

  window.__ssucreamDetail = run;
  run();
})();
