// F5 질문 응답: 단축키로 주입된다. 다시 주입되면 대화상자를 다시 연다(대화 기록 유지).
// 페이지 안 대화상자(<dialog>)를 써서 열 때 입력창으로, 닫을 때 원래 위치로 포커스가 돌아간다.
(() => {
  if (window.__ssucreamQa) {
    window.__ssucreamQa();
    return;
  }
  const { collect, focusSource, announce, el, STYLE } = window.__ssucreamPage;
  const history = [];
  let busy = false;

  const dialog = el(
    'dialog',
    null,
    // display를 지정하면 닫힌 대화상자가 숨겨지지 않으므로 상자 스타일에서 뺀다.
    // 공통 상자 스타일의 position:relative가 대화상자 기본 배치(화면 가운데 고정)를 덮지 않게 fixed로 되돌린다.
    STYLE.box.replace('display:block;', '').replace('margin:16px auto;', 'margin:auto;') +
      'position:fixed;inset:0;height:fit-content;width:min(640px,92vw);max-height:80vh;overflow:auto;'
  );
  dialog.id = 'ssucream-qa';
  dialog.setAttribute('aria-labelledby', 'ssucream-qa-title');

  const title = el('h2', '페이지에 질문하기', STYLE.heading);
  title.id = 'ssucream-qa-title';
  const help = el(
    'p',
    '이 페이지에 적힌 내용만으로 AI가 답합니다. 답은 틀릴 수 있으니 중요한 정보는 근거 위치로 이동해 확인하세요.',
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

  dialog.append(title, help, log, form, close);
  document.body.append(dialog);

  function addEntry(question) {
    const item = el('li', null, 'margin:0 0 12px;');
    const answer = el('p', '답을 찾는 중입니다.', STYLE.text);
    answer.tabIndex = -1;
    item.append(el('p', `질문: ${question}`, 'margin:0 0 4px;color:#111;font-weight:700;'), answer);
    log.append(item);
    return { item, answer };
  }

  function showAnswer(entry, result, page) {
    entry.answer.textContent = result.error ? `답변 실패. ${result.error}` : `답변: ${result.answer} (AI 답변)`;
    const source = !result.error && page.elements[result.sources[0] - 1];
    if (source) {
      const button = el('button', '근거 위치로 이동', STYLE.button);
      button.type = 'button';
      button.addEventListener('click', () => {
        dialog.close();
        if (!focusSource(source)) announce('근거 위치를 찾지 못했습니다. 페이지가 바뀌었을 수 있습니다.');
      });
      entry.item.append(button);
    }
    entry.answer.focus();
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
    announce('답을 찾는 중입니다.');
    try {
      // 요약·상세 이미지 추출 결과가 그 사이 생겼을 수 있어 질문할 때마다 새로 모은다.
      const page = collect();
      const result = await chrome.runtime.sendMessage({
        type: 'ask-page',
        page: page.payload,
        question,
        history: history.slice()
      });
      showAnswer(entry, result ?? { error: '응답이 없습니다.' }, page);
      if (!result?.error) {
        history.push({ question, answer: result.answer });
        input.value = '';
      }
    } catch (err) {
      showAnswer(entry, { error: err.message }, { elements: [] });
    } finally {
      busy = false;
    }
  });

  function open() {
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  window.__ssucreamQa = open;
  open();
})();
