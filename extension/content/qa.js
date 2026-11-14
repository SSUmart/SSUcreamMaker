// F5 질문 응답: 단축키로 주입된다. 다시 주입되면 대화상자를 다시 연다(대화 기록 유지).
// 페이지 안 대화상자(<dialog>)를 써서 열 때 입력창으로, 닫을 때 원래 위치로 포커스가 돌아간다.
(() => {
  if (window.__ssucreamQa) {
    window.__ssucreamQa();
    return;
  }
  const { collect, collectImages, hasUnreadDetailImages, focusSource, announce, el, createDialog, friendlyError, STYLE } =
    window.__ssucreamPage;
  const history = [];
  let busy = false;

  const { dialog, open: showDialog, closeTo, announce: announceInDialog } = createDialog('ssucream-qa', '페이지에 질문하기');
  const help = el(
    'p',
    '이 페이지에 적힌 내용만으로 AI가 답합니다. 페이지 글에 답이 없으면 상세 이미지 속 글자도 읽어 다시 찾습니다. 답은 틀릴 수 있으니 중요한 정보는 근거 위치로 이동해 확인하세요.',
    STYLE.note
  );

  // 질문과 답이 순서대로 쌓인다. 답이 오면 답 문단으로 포커스가 이동한다.
  const log = el('ol', null, STYLE.list);
  log.setAttribute('aria-label', '질문과 답변 기록');

  const form = el('form', null, 'margin:0 0 8px;');
  const label = el('label', '질문', 'display:block;font-weight:700;margin:0 0 4px;color:#111;');
  label.htmlFor = 'ssucream-qa-input';
  const input = el(
    'input',
    null,
    'box-sizing:border-box;width:100%;padding:6px 8px;font:16px/1.6 system-ui,sans-serif;' +
      'color:#111;background:#fff;border:1px solid #6b7280;border-radius:4px;'
  );
  input.id = 'ssucream-qa-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = '예: 배송비는 얼마인가요?';
  input.setAttribute('aria-describedby', 'ssucream-qa-error');
  const error = el('p', null, 'margin:4px 0 0;color:#b91c1c;');
  error.id = 'ssucream-qa-error';
  const submit = el('button', '질문하기', STYLE.button);
  submit.type = 'submit';
  form.append(label, input, error, submit);

  const close = el('button', '닫기', STYLE.button);
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());

  dialog.append(help, log, form, close);

  function addEntry(question) {
    const item = el('li', null, 'margin:0 0 12px;');
    const answer = el('p', '답을 찾는 중입니다.', STYLE.text);
    answer.tabIndex = -1;
    item.append(el('p', `질문: ${question}`, 'margin:0 0 4px;color:#111;font-weight:700;'), answer);
    log.append(item);
    return { item, answer, question };
  }

  const ask = (page, question) =>
    chrome.runtime.sendMessage({ type: 'ask-page', page: page.payload, question, history: history.slice() });

  // 질문하려고 읽은 상세 이미지 내용 (이 페이지 주소에서만 씀). 상세 이미지 읽기 결과 상자가 페이지에 있으면
  // collect()가 그 글을 이미 모으므로 이것은 더하지 않는다.
  let detail = null;
  let readingDetail = false;

  // 페이지 글 뒤에 상세 이미지에서 읽은 문단을 붙인다. 그 문단의 근거 위치는 첫 상세 이미지.
  function withDetail(page) {
    if (!detail || detail.url !== location.href || document.getElementById('ssucream-detail')) return page;
    const start = page.payload.paragraphs.length;
    return {
      payload: { ...page.payload, paragraphs: [...page.payload.paragraphs, ...detail.paragraphs] },
      elements: [...page.elements, ...detail.paragraphs.map(() => detail.anchor)],
      withDetail: true,
      detailStart: start
    };
  }

  // 진행 안내: 온글이 켜져 있으면 온글이, 아니면 대화상자 안의 안내 영역이 읽는다
  function tell(text) {
    const reader = globalThis.__ongeul?.reader;
    if (reader?.enabled) reader.say(text, { interrupt: false, message: true });
    else announceInDialog(text);
  }

  // 상세 이미지 속 글자를 읽어 둔다. 읽었으면 true, 시도했지만 실패했으면 false, 읽을 이미지가 없으면 null.
  // 결과는 서비스 워커가 페이지별로 저장하므로, 나중에 상세 이미지 읽기를 실행해도 AI를 다시 부르지 않는다.
  async function readDetailImages(entry) {
    const images = collectImages();
    if (!images.size) return null;
    const waiting = '페이지 글에서 찾지 못해 상세 이미지 속 글자를 읽고 다시 찾는 중입니다. 1~2분 걸릴 수 있습니다.';
    entry.answer.textContent = waiting;
    tell(waiting);
    readingDetail = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'extract-detail', urls: [...images.keys()] });
      if (!result || result.error || !result.sections?.length) return false;
      detail = {
        url: location.href,
        // 근거 위치: 첫 세로로 긴 이미지(상세 이미지). 같은 너비의 상품 사진이 앞에 있어도 그쪽으로 가지 않게 한다
        anchor:
          [...images.values()].find((img) => img.naturalWidth && img.naturalHeight >= img.naturalWidth * 1.2) ??
          images.get(result.firstUrl) ??
          images.values().next().value,
        paragraphs: result.sections.flatMap(({ title, items }) => items.map((item) => `상세 이미지 ${title}: ${item}`))
      };
      return true;
    } catch {
      return false;
    } finally {
      readingDetail = false;
    }
  }

  // 상세 이미지를 읽는 동안 서비스 워커가 보내는 진행 안내("…초 지남")를 대화상자에서 알린다
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'progress' && message.task === 'extract-detail' && readingDetail && dialog.open) tell(message.text);
  });

  function showAnswer(entry, result, page) {
    const fromDetail = !result.error && page.withDetail && result.sources?.some((n) => n > page.detailStart);
    entry.answer.textContent = result.error
      ? `답변 실패. ${result.error}`
      : `답변: ${result.answer} (${fromDetail ? '상세 이미지에서 AI가 읽은 내용으로 답변' : 'AI 답변'})`;
    if (result.detailFailed) entry.answer.textContent += ' 상세 이미지 속 글자도 읽어 보았지만 읽지 못했습니다.';
    const source = !result.error && page.elements[result.sources[0] - 1];
    if (source) {
      const button = el('button', '근거 위치로 이동', STYLE.button);
      button.type = 'button';
      button.addEventListener('click', () => {
        closeTo();
        if (!focusSource(source)) announce('근거 위치를 찾지 못했습니다. 페이지가 바뀌었을 수 있습니다.');
      });
      entry.item.append(button);
    }
    // 기다리는 동안 대화상자를 닫았으면 요약처럼 다시 열어 답을 읽는다
    if (!dialog.open) showDialog();
    entry.answer.focus();
    // 답 문단에는 이미 초점이 있어 focus()로는 다시 읽히지 않으므로, 온글이 켜져 있으면 답을 직접 읽게 하고,
    // 꺼져 있으면(다른 스크린리더) 대화상자 안의 안내 영역으로 답과 오류를 알린다
    const reader = globalThis.__ongeul?.reader;
    if (!result.error) {
      globalThis.__ongeul?.ai?.addResult({ kind: 'answer', title: `${entry.question}, 답변`, el: entry.answer, text: entry.answer.textContent });
    }
    if (reader?.enabled) reader.readElement(entry.answer);
    else announceInDialog(entry.answer.textContent);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) {
      error.textContent = '질문을 입력해주세요.';
      input.focus();
      return;
    }
    if (busy) {
      error.textContent = '이전 질문의 답을 찾는 중입니다. 잠시 후 다시 시도해주세요.';
      return;
    }
    error.textContent = '';
    busy = true;
    const entry = addEntry(question);
    // 기다리는 동안에도 점자로 다시 확인할 수 있게 "답을 찾는 중" 문단으로 포커스를 옮긴다.
    entry.answer.focus();
    // 온글이 켜져 있으면 초점을 옮긴 "답을 찾는 중" 문단을 온글이 읽으므로 안내 영역으로 또 알리지 않는다
    // (답이 빨리 오면 늦게 도착한 이 안내가 답 읽기를 방해함)
    if (!globalThis.__ongeul?.reader?.enabled) announceInDialog('답을 찾는 중입니다.');
    try {
      // 요약·상세 이미지 추출 결과가 그 사이 생겼을 수 있어 질문할 때마다 새로 모은다.
      let page = withDetail(collect());
      let result = await ask(page, question);
      // 페이지 글에 답이 없고 아직 읽지 않은 상세 이미지가 있으면, 이미지 속 글자를 읽어 한 번 더 찾는다
      // (쇼핑몰은 주의사항·사양을 상세 이미지에만 적는 경우가 많음. 읽은 결과는 이 페이지의 다음 질문에도 씀)
      if (result?.found === false && !page.withDetail && hasUnreadDetailImages()) {
        const read = await readDetailImages(entry);
        if (read) {
          page = withDetail(collect());
          result = await ask(page, question);
        } else if (read === false) {
          result = { ...result, detailFailed: true };
        }
      }
      showAnswer(entry, result ?? { error: '응답이 없습니다.' }, page);
      if (!result?.error) {
        history.push({ question, answer: result.answer });
        input.value = '';
      }
    } catch (err) {
      showAnswer(entry, { error: friendlyError(err) }, { elements: [] });
    } finally {
      busy = false;
    }
  });

  function open() {
    showDialog();
    input.focus();
  }

  window.__ssucreamQa = open;
  open();
})();
