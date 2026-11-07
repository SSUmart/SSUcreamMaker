// 응답 화면: /s/<토큰>. 문항마다 1~5점과 해당 없음 중 하나를 고르고 보낸다.
import { $, SCALE, api, h } from './common.js';

const token = location.pathname.split('/').pop();
const main = $('#main');

function show(...nodes) {
  main.replaceChildren(...nodes);
  // 화면이 바뀌면 제목으로 초점을 옮겨 스크린리더가 처음부터 읽게 한다
  const title = main.querySelector('h1');
  if (title) {
    title.tabIndex = -1;
    title.focus();
  }
}

async function load() {
  let survey;
  try {
    survey = await api(`/api/s/${token}`);
  } catch (e) {
    document.title = '설문을 열 수 없음 - 온글 평가';
    return show(h('h1', {}, '설문을 열 수 없습니다'), h('p', {}, e.message));
  }
  document.title = `${survey.title} - 온글 평가`;
  if (survey.status !== 'open') {
    return show(h('h1', {}, survey.title), h('p', { class: 'card' }, '종료된 설문입니다. 참여해 주셔서 감사합니다.'));
  }
  renderForm(survey);
}

function renderForm(survey) {
  // 오류 상자는 초점을 옮겨 읽게 한다 (role=alert까지 쓰면 같은 안내를 두 번 읽는 스크린리더가 있다)
  const errorBox = h('div', { class: 'error-box', id: 'errors', tabindex: '-1' });
  const form = h('form', { novalidate: true });
  let group = '';
  survey.questions.forEach((q, i) => {
    if (q.group && q.group !== group) {
      group = q.group;
      form.append(h('h2', { class: 'group-title' }, group));
    }
    form.append(
      h('fieldset', { class: 'q', id: `fs-${q.id}` },
        h('legend', {}, `${i + 1}. ${q.text}`),
        h('p', { class: 'sr-only', id: `err-${q.id}`, hidden: true }, '답하지 않은 문항입니다.'),
        h('div', { class: 'choices' },
          [...SCALE, { score: 0, label: '해당 없음' }].map((c) =>
            h('label', { class: c.score ? null : 'na' },
              h('input', { type: 'radio', name: q.id, value: String(c.score), id: c.score === 1 ? `first-${q.id}` : null }),
              c.score ? `${c.score}점 ${c.label}` : c.label))))
    );
  });
  form.append(
    h('label', { class: 'block', for: 'comment' }, '하고 싶은 말 (선택)'),
    h('textarea', { id: 'comment', name: 'comment', maxlength: '2000' }),
    h('p', {}, h('button', { type: 'submit', class: 'btn primary' }, '응답 보내기'))
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = {};
    const missing = [];
    survey.questions.forEach((q, i) => {
      const picked = form.querySelector(`input[name="${q.id}"]:checked`);
      const fs = $(`#fs-${q.id}`);
      const note = $(`#err-${q.id}`);
      const radios = fs.querySelectorAll('input[type="radio"]');
      if (picked) {
        answers[q.id] = Number(picked.value);
        fs.removeAttribute('aria-invalid');
        note.hidden = true;
        radios.forEach((r) => r.removeAttribute('aria-describedby'));
      } else {
        missing.push({ q, no: i + 1 });
        // 묶음(fieldset)의 aria-invalid는 읽지 않는 스크린리더가 많아, 점수 버튼마다 안내 문장을 연결한다
        fs.setAttribute('aria-invalid', 'true');
        note.hidden = false;
        radios.forEach((r) => r.setAttribute('aria-describedby', note.id));
      }
    });
    if (missing.length) {
      errorBox.replaceChildren(
        h('strong', {}, `답하지 않은 문항이 ${missing.length}개 있습니다. 문항 번호를 누르면 그 문항으로 갑니다.`),
        h('ul', {}, missing.map(({ q, no }) => h('li', {}, h('a', { href: `#first-${q.id}`, onclick: (ev) => { ev.preventDefault(); $(`#first-${q.id}`).focus(); } }, `${no}번: ${q.text}`))))
      );
      errorBox.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '보내는 중입니다';
    try {
      await api(`/api/s/${token}`, { method: 'POST', body: { answers, comment: $('#comment').value } });
      show(
        h('h1', {}, '응답해 주셔서 감사합니다'),
        h('p', { class: 'ok-box' }, '응답이 저장되었습니다. 창을 닫아도 됩니다.'),
        h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => renderForm(survey) }, '다른 사람이 새로 응답하기'))
      );
    } catch (err) {
      errorBox.replaceChildren(h('strong', {}, `응답을 보내지 못했습니다. ${err.message}`));
      errorBox.focus();
      button.disabled = false;
      button.textContent = '응답 보내기';
    }
  });

  show(
    h('p', {}, h('span', { class: survey.role === 'team' ? 'tag team' : 'tag' }, survey.role === 'team' ? '팀원 평가' : '사용자 평가')),
    h('h1', {}, survey.title),
    survey.description ? h('p', { style: 'white-space: pre-line' }, survey.description) : null,
    h('div', { class: 'card' },
      h('p', {}, `문항은 모두 ${survey.questions.length}개입니다. 문항마다 1점(매우 불만족)부터 5점(매우 만족) 중 하나를 고르세요.`),
      h('p', {}, '써 보지 않은 기능이면 "해당 없음"을 고르세요. 이름 등 개인 정보는 받지 않습니다.')),
    errorBox,
    form
  );
}

load();
