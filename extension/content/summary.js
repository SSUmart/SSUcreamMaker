// F4 내용 요약: 단축키로 주입된다. 다시 주입되면 이미 정의된 run만 다시 실행한다.
// 요약은 화면에도 보이는 상자로 페이지 맨 앞에 넣고, 결과·오류 모두 그 상자에 남긴다(점자 우선).
(() => {
  if (window.__ssucreamSummary) {
    window.__ssucreamSummary();
    return;
  }
  const { collect, focusSource, hasUnreadDetailImages, announce, clearStatus, el, STYLE } = window.__ssucreamPage;
  let busy = false;

  // 요약 상자를 (다시) 만들고 제목으로 포커스를 옮긴다.
  function showBox(titleText, build, returnFocus) {
    document.getElementById('ssucream-summary')?.remove();
    const box = el('section', null, STYLE.box);
    box.id = 'ssucream-summary';
    box.setAttribute('aria-labelledby', 'ssucream-summary-title');
    const title = el('h2', titleText, STYLE.heading);
    title.id = 'ssucream-summary-title';
    title.tabIndex = -1;
    box.append(title);
    build(box);

    const close = el('button', '요약 닫기', STYLE.button);
    close.type = 'button';
    close.addEventListener('click', () => {
      box.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
    });
    box.append(close);

    document.body.prepend(box);
    box.scrollIntoView({ block: 'start' });
    title.focus({ preventScroll: true });
  }

  function renderResult(result, page, returnFocus) {
    showBox('페이지 요약, AI 생성', (box) => {
      if (result.overview) box.append(el('p', result.overview, STYLE.text));

      let note = 'AI가 페이지 글을 요약했습니다. 틀릴 수 있으니 가격 같은 중요한 정보는 원문으로 이동해 확인하세요.';
      if (page.payload.truncated) note += ' 페이지가 길어 앞부분만 요약했습니다.';
      if (hasUnreadDetailImages()) {
        note += ' 상세 설명 이미지의 글자는 아직 포함되지 않았습니다. 온글 키와 D 키를 함께 눌러 상세 이미지를 먼저 읽으면 요약에 포함됩니다.';
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
            if (!focusSource(source)) announce('원문 위치를 찾지 못했습니다. 페이지가 바뀌었을 수 있습니다.');
          });
          li.append(' ', button);
        }
        list.append(li);
      });
      box.append(list);
    }, returnFocus);
    // 온글 스크린리더가 켜져 있으면 요약 상자를 처음부터 끝까지 바로 읽고, 아니면 안내 영역으로 알린다
    const reader = globalThis.__ongeul?.reader;
    const box = document.getElementById('ssucream-summary');
    globalThis.__ongeul?.ai?.addResult({ kind: 'summary', title: `페이지 요약, ${result.items.length}개 항목`, el: box });
    if (reader?.enabled) {
      clearStatus();
      reader.readElement(box);
    }
    else announce('요약 완료. 요약 제목으로 이동했습니다.');
  }

  function renderError(message, returnFocus) {
    showBox('페이지 요약 실패', (box) => box.append(el('p', message, STYLE.text)), returnFocus);
    // 오류도 소리로 알린다 (제목으로 초점만 옮기면 오류 내용을 듣지 못함)
    announce(`페이지 요약 실패. ${message}`);
  }

  async function run() {
    if (busy) {
      announce('이미 요약하는 중입니다.');
      return;
    }
    busy = true;
    const active = document.activeElement;
    const returnFocus = active && active !== document.body && !active.closest('#ssucream-summary') ? active : null;
    try {
      const page = collect();
      if (!page.payload.paragraphs.length) {
        renderError('이 페이지에서 요약할 글을 찾지 못했습니다.', returnFocus);
        return;
      }
      // 기다리는 동안에도 점자로 다시 확인할 수 있게 상자에 남긴다.
      showBox('페이지 요약 중', (box) => box.append(el('p', '페이지 글을 요약하는 중입니다. 잠시 기다려주세요.', STYLE.text)), returnFocus);
      // 온글이 켜져 있으면 초점이 간 "페이지 요약 중" 제목을 읽으므로 따로 알리지 않는다
      if (!globalThis.__ongeul?.reader?.enabled) announce('페이지 글을 요약하는 중입니다.');
      const result = await chrome.runtime.sendMessage({ type: 'summarize-page', page: page.payload });
      if (result?.error) renderError(result.error, returnFocus);
      else renderResult(result, page, returnFocus);
    } catch (error) {
      renderError(`오류가 발생했습니다. ${error.message}`, returnFocus);
    } finally {
      busy = false;
    }
  }

  window.__ssucreamSummary = run;
  run();
})();
