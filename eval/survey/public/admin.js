// 관리자 화면: 로그인 → 설문 목록·새 설문 → 설문 상세(링크, 응답 수, AI 답 입력, 종료, 결과 페이지 주소·공개).
// 분석표는 결과 페이지(<앞부분>/result-<순번>, result.js)에서 따로 본다.
// 주소 # 뒤로 화면을 나눈다: #/ 목록, #/s/<id> 상세, #/s/<id>/edit 수정
import { $, BASE, api, fmtDate, h } from './common.js';

const main = $('#main');
const say = (msg) => {
  $('#live').textContent = '';
  setTimeout(() => ($('#live').textContent = msg), 50);
};
const adminApi = (path, opts = {}) =>
  api(path, { ...opts, admin: true }).catch((e) => {
    if (e.status === 401) {
      renderLogin('로그인이 끝났습니다. 다시 로그인해 주세요.');
      throw Object.assign(e, { handled: true });
    }
    throw e;
  });

function show(title, ...nodes) {
  document.title = `${title} - 온글 평가 설문 관리`;
  main.replaceChildren(...nodes);
  const h1 = main.querySelector('h1');
  if (h1) {
    h1.tabIndex = -1;
    h1.focus();
  }
}

// 실패를 대화상자로 알린다 (스크린리더도 바로 읽음)
const alertFail = (what, err) => alert(`${what}. ${err.message}`);

// ---------- 로그인 ----------
function renderLogin(message = '') {
  const error = h('p', { class: 'error-box', role: 'alert', id: 'login-error' }, message);
  const form = h('form', {},
    h('label', { class: 'block', for: 'password' }, '관리자 비밀번호'),
    h('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true }),
    h('p', {}, h('button', { class: 'btn primary', type: 'submit' }, '로그인')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/session', { method: 'POST', body: { password: $('#password').value } });
      location.hash = '#/';
      route();
    } catch (err) {
      error.textContent = err.message;
      $('#password').select();
    }
  });
  show('로그인', h('h1', {}, '온글 평가 설문 관리'), error, form);
}

// ---------- 목록 ----------
async function renderList() {
  const surveys = await adminApi('/api/admin/surveys');
  const table = surveys.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('caption', { class: 'sr-only' }, '설문 목록'),
        h('thead', {}, h('tr', {}, ['설문', '상태', '문항', '팀원 응답', '사용자 응답', 'AI 답', '만든 날', '분석표'].map((t, i) => h('th', { scope: 'col', class: i >= 2 && i <= 5 ? 'num' : null }, t)))),
        h('tbody', {}, surveys.map((s) => h('tr', {},
          h('td', {}, h('a', { href: `#/s/${s.id}` }, s.title)),
          h('td', {}, h('span', { class: s.status === 'open' ? 'tag' : 'tag closed' }, s.status === 'open' ? '진행 중' : '종료')),
          h('td', { class: 'num' }, s.questions),
          h('td', { class: 'num' }, s.counts.team),
          h('td', { class: 'num' }, s.counts.user),
          h('td', { class: 'num' }, s.counts.ai),
          h('td', {}, fmtDate(s.createdAt)),
          h('td', {}, s.status === 'closed'
            ? h('a', { href: `${BASE}/result-${s.no}`, 'aria-label': `${s.title} 분석표` }, `결과 ${s.no}번`, s.resultPublic ? ' (공개)' : '')
            : h('span', { class: 'muted' }, '끝낸 뒤')))))))
    : h('p', { class: 'card' }, '아직 만든 설문이 없습니다. 아래에서 새 설문을 만드세요.');

  const error = h('div', { class: 'error-box', tabindex: '-1' });
  const form = h('form', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, '새 설문 만들기'),
    h('label', { class: 'block', for: 'title' }, '설문 제목'),
    h('input', { type: 'text', id: 'title', maxlength: '200', placeholder: '예: 온글 1차 사용자 평가' }),
    h('label', { class: 'block', for: 'description' }, '안내 문구 (선택, 응답 화면 맨 위에 나옴)'),
    h('textarea', { id: 'description', maxlength: '2000' }),
    h('label', { class: 'block', for: 'questions' }, '문항 (한 줄에 한 문항)'),
    h('p', { class: 'hint', id: 'questions-hint' }, '"# 영역 이름" 줄(# 뒤에 띄어쓰기)을 넣으면 그 아래 문항이 그 영역으로 묶입니다. 줄 앞의 번호는 지워도 되고 그대로 둬도 됩니다. 응답을 받기 전까지는 문항을 고칠 수 있습니다.'),
    h('textarea', { id: 'questions', class: 'tall', 'aria-describedby': 'questions-hint', placeholder: '# 시작하기\n온글을 켰을 때 들은 첫 안내에 얼마나 만족하셨나요?\n# AI 기능\n상세 이미지 속 글자를 읽어 준 결과에 얼마나 만족하셨나요?' }),
    error,
    h('p', {}, h('button', { class: 'btn primary', type: 'submit' }, '설문 만들기')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const s = await adminApi('/api/admin/surveys', { method: 'POST', body: { title: $('#title').value, description: $('#description').value, questionsText: $('#questions').value } });
      location.hash = `#/s/${s.id}`;
    } catch (err) {
      if (err.handled) return;
      error.textContent = err.message;
      error.focus();
    }
  });

  show('설문 목록',
    h('div', { class: 'topbar' }, h('h1', {}, '설문 목록'), logoutButton()),
    table, form);
}

function logoutButton() {
  return h('button', { class: 'btn small no-print', type: 'button', onclick: async () => {
    await api('/api/admin/session', { method: 'DELETE' }).catch(() => {});
    renderLogin('로그아웃했습니다.');
  } }, '로그아웃');
}

// 주소 칸과 복사 버튼
function copyField(label, url, inputId) {
  return h('div', {},
    h('label', { class: 'block', for: inputId }, label),
    h('div', { class: 'link-field' },
      h('input', { type: 'text', id: inputId, readonly: true, value: url }),
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          $(`#${inputId}`).select();
          document.execCommand('copy');
        }
        say(`${label}를 복사했습니다.`);
      } }, '복사')));
}

// ---------- 상세 ----------
async function renderSurvey(id) {
  const s = await adminApi(`/api/admin/surveys/${id}`);
  const open = s.status === 'open';
  const linkField = (role) => copyField(role === 'team' ? '팀원용 링크' : '사용자용 링크', `${location.origin}${BASE}/s/${s.tokens[role]}`, `link-${role}`);

  const closeButton = open && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (!confirm('설문을 끝낼까요? 끝내면 더 이상 응답을 받지 않고, 다시 열 수 없습니다.')) return;
    try {
      await adminApi(`/api/admin/surveys/${id}/close`, { method: 'POST' });
    } catch (err) {
      if (!err.handled) alertFail('설문을 끝내지 못했습니다', err);
      return;
    }
    say('설문을 끝냈습니다. 결과 페이지에서 분석표를 볼 수 있습니다.');
    renderSurvey(id);
  } }, '설문 끝내기');

  const manage = h('section', { class: 'card no-print', 'aria-labelledby': 'manage-title' },
    h('h2', { id: 'manage-title', style: 'margin-top:0' }, '설문 관리'),
    h('p', { class: 'row' },
      h('a', { class: 'btn', href: `#/s/${id}/edit` }, '수정'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          const copy = await adminApi(`/api/admin/surveys/${id}/copy`, { method: 'POST' });
          say(`${copy.title} 설문을 만들었습니다.`);
          location.hash = `#/s/${copy.id}`;
        } catch (err) {
          if (!err.handled) alertFail('설문을 복제하지 못했습니다', err);
        }
      } }, '복제'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const n = s.counts.team + s.counts.user;
        const lost = n || s.counts.ai ? ` 받은 응답 ${n}개와 AI 답 ${s.counts.ai}개도 함께 사라지고,` : '';
        if (!confirm(`"${s.title}" 설문을 삭제할까요?${lost} 팀원·사용자 링크로 더 이상 들어올 수 없습니다.`)) return;
        try {
          await adminApi(`/api/admin/surveys/${id}`, { method: 'DELETE' });
        } catch (err) {
          if (!err.handled) alertFail('설문을 삭제하지 못했습니다', err);
          return;
        }
        say(`${s.title} 설문을 삭제했습니다.`);
        location.hash = '#/';
      } }, '삭제')),
    h('p', { class: 'hint' },
      s.questionsEditable
        ? '아직 응답이 없어 제목, 안내 문구, 문항을 모두 고칠 수 있습니다. 복제는 문항이 같은 새 설문(새 링크)을 만듭니다. 삭제한 설문은 서버의 휴지통(데이터 폴더의 trash)으로 옮겨집니다.'
        : '응답이나 AI 답을 받은 설문은 제목과 안내 문구만 고칠 수 있습니다. 문항을 바꾸려면 복제한 새 설문에서 고치세요. 삭제한 설문은 서버의 휴지통(데이터 폴더의 trash)으로 옮겨집니다.'));

  show(s.title,
    h('p', { class: 'no-print' }, h('a', { href: '#/' }, '설문 목록으로')),
    h('div', { class: 'topbar' }, h('h1', {}, s.title), logoutButton()),
    h('p', {}, h('span', { class: open ? 'tag' : 'tag closed' }, open ? '진행 중' : '종료'),
      ` 문항 ${s.questions}개 · 만든 날 ${fmtDate(s.createdAt)}${s.closedAt ? ` · 끝낸 날 ${fmtDate(s.closedAt)}` : ''}`),
    h('section', { class: 'card no-print', 'aria-labelledby': 'resp-title' },
      h('h2', { id: 'resp-title', style: 'margin-top:0' }, '응답 현황'),
      h('ul', {},
        h('li', {}, `팀원 응답 ${s.counts.team}개`),
        h('li', {}, `사용자 응답 ${s.counts.user}개`),
        h('li', {}, `AI 답 ${s.counts.ai}개`)),
      open ? [linkField('team'), linkField('user'), h('p', { class: 'hint' }, '링크를 받은 사람은 로그인 없이 응답할 수 있습니다. 한 PC에서 여러 사람이 차례로 응답해도 됩니다.')] : h('p', {}, '종료된 설문이라 링크로 응답할 수 없습니다.'),
      h('p', { class: 'row' }, closeButton, h('a', { class: 'btn', href: `${BASE}/api/admin/surveys/${id}/responses.csv` }, '응답 내려받기 (CSV)'))),
    manage,
    aiSection(s),
    resultSection(s),
    h('details', { class: 'card no-print' }, h('summary', {}, `문항 보기 (${s.questions}개)`),
      h('ol', {}, s.questionList.map((q) => h('li', {}, q.group ? `[${q.group}] ${q.text}` : q.text)))));
}

// 결과 페이지: 주소(result-<순번>), 열기, 공개 여부
function resultSection(s) {
  const url = `${location.origin}${BASE}/result-${s.no}`;
  const closed = s.status === 'closed';
  const toggle = h('input', { type: 'checkbox', id: 'result-public', checked: s.resultPublic, 'aria-describedby': 'result-public-hint' });
  toggle.addEventListener('change', async () => {
    const want = toggle.checked;
    try {
      await adminApi(`/api/admin/surveys/${s.id}`, { method: 'PATCH', body: { resultPublic: want } });
      s.resultPublic = want;
      say(want ? '결과를 공개했습니다. 주소를 아는 사람은 로그인 없이 분석표를 볼 수 있습니다.' : '결과 공개를 껐습니다. 이제 관리자만 분석표를 볼 수 있습니다.');
    } catch (err) {
      toggle.checked = !want;
      if (!err.handled) alertFail('결과 공개를 바꾸지 못했습니다', err);
    }
  });
  return h('section', { class: 'card', 'aria-labelledby': 'an-title' },
    h('h2', { id: 'an-title', style: 'margin-top:0' }, '분석표 (결과 페이지)'),
    h('p', {}, closed
      ? 'AI 평가, 팀원 평가, 사용자 평가를 비교하는 분석표를 결과 페이지에서 볼 수 있습니다.'
      : '설문을 끝내면 이 주소에서 AI 평가, 팀원 평가, 사용자 평가를 비교하는 분석표를 볼 수 있습니다.'),
    copyField('결과 페이지 주소', url, 'result-url'),
    closed ? h('p', {}, h('a', { class: 'btn primary', href: `${BASE}/result-${s.no}` }, '분석표 열기')) : null,
    h('p', { class: 'row no-print' }, toggle, h('label', { for: 'result-public' }, '결과 공개 (로그인 없이 주소로 보기)')),
    h('p', { class: 'hint', id: 'result-public-hint' }, '공개하면 주소를 아는 누구나 분석표와 응답자가 남긴 "하고 싶은 말"을 볼 수 있습니다. 끄면 관리자만 봅니다. 설문을 끝내기 전에는 공개해도 분석표가 나오지 않습니다.'));
}

// ---------- 수정 ----------
async function renderEdit(id) {
  const s = await adminApi(`/api/admin/surveys/${id}`);
  const error = h('div', { class: 'error-box', tabindex: '-1' });
  const form = h('form', { class: 'card' },
    h('label', { class: 'block', for: 'title' }, '설문 제목'),
    h('input', { type: 'text', id: 'title', maxlength: '200', value: s.title }),
    h('label', { class: 'block', for: 'description' }, '안내 문구 (선택, 응답 화면 맨 위에 나옴)'),
    h('textarea', { id: 'description', maxlength: '2000' }, s.description),
    h('label', { class: 'block', for: 'questions' }, '문항 (한 줄에 한 문항)'),
    h('p', { class: 'hint', id: 'questions-hint' }, s.questionsEditable
      ? '"# 영역 이름" 줄(# 뒤에 띄어쓰기)을 넣으면 그 아래 문항이 그 영역으로 묶입니다. 아직 응답이 없어 문항을 고칠 수 있습니다.'
      : `응답이나 AI 답을 받은 설문이라 문항은 고칠 수 없습니다(팀원 ${s.counts.team}개, 사용자 ${s.counts.user}개, AI ${s.counts.ai}개). 문항을 바꾸려면 설문 화면에서 "복제"로 새 설문을 만드세요.`),
    h('textarea', { id: 'questions', class: 'tall', 'aria-describedby': 'questions-hint', readonly: !s.questionsEditable }, s.questionsText),
    error,
    h('p', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, '저장'),
      h('a', { class: 'btn', href: `#/s/${id}` }, '취소')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { title: $('#title').value, description: $('#description').value };
    if (s.questionsEditable) body.questionsText = $('#questions').value;
    try {
      await adminApi(`/api/admin/surveys/${id}`, { method: 'PATCH', body });
      say('설문을 고쳤습니다.');
      location.hash = `#/s/${id}`;
    } catch (err) {
      if (err.handled) return;
      error.textContent = err.message;
      error.focus();
    }
  });
  show(`${s.title} 수정`,
    h('p', {}, h('a', { href: `#/s/${id}` }, '설문으로 돌아가기')),
    h('h1', {}, '설문 수정'),
    form);
}

function aiSection(s) {
  const error = h('div', { class: 'error-box', tabindex: '-1' });
  const save = async (allowMissing) => {
    try {
      await adminApi(`/api/admin/surveys/${s.id}/ai`, { method: 'POST', body: { source: $('#ai-source').value, text: $('#ai-text').value, allowMissing } });
      say('AI 답을 저장했습니다.');
      renderSurvey(s.id);
    } catch (err) {
      if (err.handled) return;
      error.replaceChildren(h('p', {}, err.message),
        err.data?.missing?.length && !allowMissing
          ? h('button', { class: 'btn small', type: 'button', onclick: () => save(true) }, '빠진 문항은 해당 없음으로 저장')
          : null);
      error.focus();
    }
  };
  return h('section', { class: 'card no-print', 'aria-labelledby': 'ai-title' },
    h('h2', { id: 'ai-title', style: 'margin-top:0' }, 'AI 평가 입력'),
    h('ol', {},
      h('li', {}, '아래 질문 글을 복사해 Claude, ChatGPT, Gemini 등에 붙여 넣습니다. README나 문서를 함께 첨부하면 더 정확합니다.'),
      h('li', {}, 'AI가 "번호 | 점수 | 이유" 줄로 답하면 그 답을 통째로 복사해 아래에 붙여 넣고 저장합니다.'),
      h('li', {}, '여러 AI에 물어 저장하면 분석표의 AI 점수는 그 평균입니다.')),
    h('details', {}, h('summary', {}, 'AI에 보낼 질문 글 보기'),
      h('label', { class: 'block', for: 'ai-prompt' }, 'AI에 보낼 질문 글'),
      h('textarea', { id: 'ai-prompt', class: 'tall', readonly: true }, s.aiPrompt),
      h('p', {}, h('button', { class: 'btn small', type: 'button', onclick: async () => {
        try {
          await navigator.clipboard.writeText(s.aiPrompt);
        } catch {
          $('#ai-prompt').select();
          document.execCommand('copy');
        }
        say('질문 글을 복사했습니다.');
      } }, '질문 글 복사'))),
    h('label', { class: 'block', for: 'ai-source' }, 'AI 이름'),
    h('input', { type: 'text', id: 'ai-source', maxlength: '60', placeholder: '예: Claude Opus 5.5' }),
    h('label', { class: 'block', for: 'ai-text' }, 'AI 답'),
    h('textarea', { id: 'ai-text', class: 'tall', placeholder: '1 | 4 | 이유\n2 | 3 | 이유' }),
    error,
    h('p', {}, h('button', { class: 'btn primary', type: 'button', onclick: () => save(false) }, 'AI 답 저장')),
    s.aiAnswers.length
      ? h('div', {}, h('h3', {}, '저장한 AI 답'), h('ul', {}, s.aiAnswers.map((a) => h('li', {},
          `${a.source} · 점수 ${a.answered}개 · ${fmtDate(a.enteredAt)} `,
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
            if (!confirm(`${a.source}의 답을 지울까요?`)) return;
            try {
              await adminApi(`/api/admin/surveys/${s.id}/ai/${a.id}`, { method: 'DELETE' });
            } catch (err) {
              if (!err.handled) alertFail('AI 답을 지우지 못했습니다', err);
              return;
            }
            say('AI 답을 지웠습니다.');
            renderSurvey(s.id);
          } }, `${a.source} 답 지우기`)))))
      : null);
}

// ---------- 화면 나누기 ----------
async function route() {
  try {
    const { admin } = await api('/api/admin/session');
    if (!admin) return renderLogin();
    const m = location.hash.match(/^#\/s\/([A-Za-z0-9_-]+)(\/edit)?$/);
    if (m?.[2]) await renderEdit(m[1]);
    else if (m) await renderSurvey(m[1]);
    else await renderList();
  } catch (e) {
    if (e.handled) return;
    show('오류', h('h1', {}, '불러오지 못했습니다'), h('p', {}, e.message), h('p', {}, h('a', { href: '#/' }, '설문 목록으로')));
  }
}

window.addEventListener('hashchange', route);
route();
