// F4 내용 요약: 단축키로 주입된다. 다시 주입되면 이미 정의된 run만 다시 실행한다.
// 요약은 질문하기와 같은 화면 가운데 대화상자로 보여 주고(페이지 레이아웃을 건드리지 않음), 결과·오류 모두 그 안에 남긴다(점자 우선).
// 같은 페이지에서 다시 실행하면 AI를 다시 부르지 않고 마지막 요약을 다시 연다. 그 사이 페이지 글이 바뀌었으면
// (상세 이미지를 읽었거나 탭·옵션을 바꾼 경우 등) 새로 요약한다.
(() => {
  if (window.__ssucreamSummary) {
    window.__ssucreamSummary();
    return;
  }
  const { collect, focusSource, hasUnreadDetailImages, announce, clearStatus, el, createDialog, friendlyError, STYLE } = window.__ssucreamPage;
  const { dialog, title, open: showDialog, closeTo } = createDialog('ssucream-summary', '페이지 요약');
  const body = el('div');
  const close = el('button', '요약 닫기', STYLE.button);
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  dialog.append(body, close);

  let busy = false;
  // 마지막으로 끝난 요약의 페이지 주소와 그때 보낸 글 (둘 다 같으면 다시 열기만 한다)
  let doneUrl = '';
  let doneText = '';
  const textOf = (page) => JSON.stringify([page.payload.title, page.payload.paragraphs]);

  // 대화상자 내용을 바꾸고 (닫혀 있으면 열고) 제목으로 초점을 옮긴다.
  function show(titleText, build) {
    title.textContent = titleText;
    body.replaceChildren();
    build(body);
    showDialog();
    title.focus();
  }

  // 온글 스크린리더가 켜져 있으면 요약 전체를 처음부터 끝까지 읽고, 아니면 안내 영역으로 알린다
  function readAll() {
    const reader = globalThis.__ongeul?.reader;
    if (reader?.enabled) {
      clearStatus();
      reader.readElement(dialog);
    } else announce('요약 완료. 요약 제목으로 이동했습니다.');
  }

  function reopen() {
    // 그 사이 다른 요약을 하다 실패했거나 페이지 글이 바뀌었으면 다시 요약한다
    if (doneUrl !== location.href || doneText !== textOf(collect())) {
      run();
      return;
    }
    showDialog();
    title.focus();
    readAll();
  }

  function renderResult(result, page) {
    show('페이지 요약, AI 생성', (box) => {
      if (result.overview) box.append(el('p', result.overview, STYLE.text));

      let note = 'AI가 페이지 글을 요약했습니다. 틀릴 수 있으니 가격 같은 중요한 정보는 원문으로 이동해 확인하세요.';
      if (page.payload.truncated) note += ' 페이지가 길어 앞부분만 요약했습니다.';
      if (hasUnreadDetailImages()) {
        const key = globalThis.__ongeul?.guidance?.keyNames(globalThis.__ongeul?.reader?.settings?.reader?.commandKeys).detail ?? 'Alt와 Shift와 D';
        note += ` 상세 설명 이미지의 글자는 아직 포함되지 않았습니다. ${key} 키를 눌러 상세 이미지를 먼저 읽으면 요약에 포함됩니다.`;
      }
      box.append(el('p', note, STYLE.note));

      if (!result.items.length) {
        box.append(el('p', '요약할 내용을 찾지 못했습니다.', STYLE.text));
        return;
      }
      const list = el('ul', null, STYLE.list);
      result.items.forEach((item, i) => {
        const li = el('li', item.text);
        const source = page.elements[item.sources[0] - 1];
        if (source) {
          const button = el('button', `${i + 1}번 원문으로 이동`, STYLE.button);
          button.type = 'button';
          button.addEventListener('click', () => {
            closeTo();
            if (!focusSource(source)) announce('원문 위치를 찾지 못했습니다. 페이지가 바뀌었을 수 있습니다.');
          });
          li.append(' ', button);
        }
        list.append(li);
      });
      box.append(list);
    });
    doneUrl = location.href;
    doneText = textOf(page);
    globalThis.__ongeul?.ai?.addResult({ kind: 'summary', title: `페이지 요약, ${result.items.length}개 항목`, el: dialog, open: reopen });
    readAll();
  }

  function renderError(message) {
    show('페이지 요약 실패', (box) => box.append(el('p', message, STYLE.text)));
    // 오류도 소리로 알린다 (제목으로 초점만 옮기면 오류 내용을 듣지 못함)
    announce(`페이지 요약 실패. ${message}`);
  }

  async function run() {
    if (busy) {
      showDialog();
      announce('이미 요약하는 중입니다.');
      return;
    }
    if (doneUrl === location.href && doneText === textOf(collect())) {
      reopen();
      return;
    }
    busy = true;
    // 새로 요약하는 동안이나 실패하면 대화상자 내용이 바뀌므로 "마지막 요약"이 아니게 된다
    doneUrl = '';
    doneText = '';
    try {
      const page = collect();
      if (!page.payload.paragraphs.length) {
        renderError('이 페이지에서 요약할 글을 찾지 못했습니다.');
        return;
      }
      // 기다리는 동안에도 점자로 다시 확인할 수 있게 대화상자에 남긴다.
      show('페이지 요약 중', (box) => box.append(el('p', '페이지 글을 요약하는 중입니다. 잠시 기다려주세요.', STYLE.text)));
      // 온글이 켜져 있으면 초점이 간 "페이지 요약 중" 제목을 읽으므로 따로 알리지 않는다
      if (!globalThis.__ongeul?.reader?.enabled) announce('페이지 글을 요약하는 중입니다.');
      const result = await chrome.runtime.sendMessage({ type: 'summarize-page', page: page.payload });
      if (result?.error) renderError(result.error);
      else renderResult(result, page);
    } catch (error) {
      renderError(friendlyError(error));
    } finally {
      busy = false;
    }
  }

  // 오래 걸리면 서비스 워커가 지난 시간을 알려 준다: 대화상자의 기다림 문장과 안내 영역을 함께 바꾼다
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'progress' || message.task !== 'summarize-page' || !busy) return;
    const waiting = body.querySelector('p');
    if (waiting) waiting.textContent = `${message.text}. 잠시 기다려주세요.`;
    announce(message.text);
  });

  window.__ssucreamSummary = run;
  run();
})();
