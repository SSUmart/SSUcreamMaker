// 관리자 화면: 로그인 → 설문 목록·새 설문 → 설문 상세(링크, 응답 수, AI 답 입력, 종료) → 분석표.
// 주소 # 뒤로 화면을 나눈다: #/ 목록, #/s/<id> 상세
import { $, BASE, api, fmtDate, h } from './common.js';

const main = $('#main');
const ROLE = { ai: 'AI 평가', team: '팀원 평가', user: '사용자 평가' };
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

const fmt = (n, d = 2) => (n == null ? '–' : n.toFixed(d));
const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);
function diffCell(v) {
  if (v == null) return h('td', { class: 'num' }, '–');
  const cls = v >= 0.5 ? 'diff up' : v <= -0.5 ? 'diff down' : 'diff';
  return h('td', { class: `num ${cls}` }, `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
}
function scoreCell(s, kind) {
  if (s.mean == null) return h('td', { class: 'num' }, '–', h('span', { class: 'sr-only' }, ' 응답 없음'));
  return h('td', { class: `num ${kind}` },
    `${s.mean.toFixed(2)}`, h('span', { class: 'muted' }, ` (${s.n})`),
    h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar', style: `width:${(s.mean / 5) * 100}%` })));
}

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
        h('thead', {}, h('tr', {}, ['설문', '상태', '문항', '팀원 응답', '사용자 응답', 'AI 답', '만든 날'].map((t, i) => h('th', { scope: 'col', class: i >= 2 && i <= 5 ? 'num' : null }, t)))),
        h('tbody', {}, surveys.map((s) => h('tr', {},
          h('td', {}, h('a', { href: `#/s/${s.id}` }, s.title)),
          h('td', {}, h('span', { class: s.status === 'open' ? 'tag' : 'tag closed' }, s.status === 'open' ? '진행 중' : '종료')),
          h('td', { class: 'num' }, s.questions),
          h('td', { class: 'num' }, s.counts.team),
          h('td', { class: 'num' }, s.counts.user),
          h('td', { class: 'num' }, s.counts.ai),
          h('td', {}, fmtDate(s.createdAt)))))))
    : h('p', { class: 'card' }, '아직 만든 설문이 없습니다. 아래에서 새 설문을 만드세요.');

  const error = h('div', { class: 'error-box', tabindex: '-1' });
  const form = h('form', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, '새 설문 만들기'),
    h('label', { class: 'block', for: 'title' }, '설문 제목'),
    h('input', { type: 'text', id: 'title', maxlength: '200', placeholder: '예: 온글 1차 사용자 평가' }),
    h('label', { class: 'block', for: 'description' }, '안내 문구 (선택, 응답 화면 맨 위에 나옴)'),
    h('textarea', { id: 'description', maxlength: '2000' }),
    h('label', { class: 'block', for: 'questions' }, '문항 (한 줄에 한 문항)'),
    h('p', { class: 'hint', id: 'questions-hint' }, '"# 영역 이름" 줄(# 뒤에 띄어쓰기)을 넣으면 그 아래 문항이 그 영역으로 묶입니다. 줄 앞의 번호는 지워도 되고 그대로 둬도 됩니다. 만든 뒤에는 문항을 고칠 수 없습니다.'),
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

// ---------- 상세 ----------
async function renderSurvey(id) {
  const s = await adminApi(`/api/admin/surveys/${id}`);
  const open = s.status === 'open';
  const linkField = (role) => {
    const url = `${location.origin}${BASE}/s/${s.tokens[role]}`;
    const inputId = `link-${role}`;
    return h('div', {},
      h('label', { class: 'block', for: inputId }, role === 'team' ? '팀원용 링크' : '사용자용 링크'),
      h('div', { class: 'link-field' },
        h('input', { type: 'text', id: inputId, readonly: true, value: url }),
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
          } catch {
            $(`#${inputId}`).select();
            document.execCommand('copy');
          }
          say(`${role === 'team' ? '팀원용' : '사용자용'} 링크를 복사했습니다.`);
        } }, '복사')));
  };

  const closeButton = open && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (!confirm('설문을 끝낼까요? 끝내면 더 이상 응답을 받지 않고, 다시 열 수 없습니다.')) return;
    try {
      await adminApi(`/api/admin/surveys/${id}/close`, { method: 'POST' });
    } catch (err) {
      if (!err.handled) alertFail('설문을 끝내지 못했습니다', err);
      return;
    }
    say('설문을 끝냈습니다. 분석표를 만들었습니다.');
    renderSurvey(id);
  } }, '설문 끝내기');

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
    aiSection(s),
    s.analysis ? analysisSection(s) : h('section', { class: 'card', 'aria-labelledby': 'an-title' },
      h('h2', { id: 'an-title', style: 'margin-top:0' }, '분석표'),
      h('p', {}, '설문을 끝내면 AI 평가, 팀원 평가, 사용자 평가를 비교하는 분석표가 여기에 나옵니다.')),
    h('details', { class: 'card no-print' }, h('summary', {}, `문항 보기 (${s.questions}개)`),
      h('ol', {}, s.questionList.map((q) => h('li', {}, q.group ? `[${q.group}] ${q.text}` : q.text)))));
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

function analysisSection(s) {
  const a = s.analysis;
  const card = (kind, label, value, n) =>
    h('div', { class: `score-card ${kind}` },
      h('p', { style: 'margin:0;font-weight:700' }, label),
      h('p', { class: 'big', style: 'margin:4px 0' }, value == null ? '–' : value.toFixed(2)),
      h('p', { class: 'muted', style: 'margin:0' }, value == null ? '응답 없음' : `5점 만점 · ${kind === 'ai' ? `AI ${n}개` : `응답 ${n}명`}`));
  const compareHead = (first) => h('thead', {}, h('tr', {},
    h('th', { scope: 'col' }, first),
    h('th', { scope: 'col', class: 'num' }, 'AI'),
    h('th', { scope: 'col', class: 'num' }, '팀원'),
    h('th', { scope: 'col', class: 'num' }, '사용자'),
    h('th', { scope: 'col', class: 'num' }, '사용자 − AI'),
    h('th', { scope: 'col', class: 'num' }, '사용자 − 팀원')));

  return h('section', { 'aria-labelledby': 'an-title' },
    h('div', { class: 'topbar' }, h('h2', { id: 'an-title' }, '분석표'),
      h('button', { class: 'btn small no-print', type: 'button', onclick: () => window.print() }, '인쇄 또는 PDF로 저장')),
    h('p', { class: 'hint' }, '점수는 해당 없음을 뺀 평균입니다(1 매우 불만족 ~ 5 매우 만족). 영역·전체 점수는 문항 평균의 평균입니다. 차이가 +0.5 이상이면 초록, −0.5 이하면 빨강으로 표시합니다.'),
    h('div', { class: 'scores' },
      card('ai', ROLE.ai, a.overall.ai, a.counts.ai),
      card('team', ROLE.team, a.overall.team, a.counts.team),
      card('user', ROLE.user, a.overall.user, a.counts.user)),

    a.notable.length || a.lowest.length
      ? h('div', { class: 'card' },
          h('h3', { style: 'margin-top:0' }, '눈여겨볼 문항'),
          a.notable.length
            ? h('div', {}, h('p', {}, '사용자 점수가 팀원·AI 평가와 0.5점 이상 다른 문항:'),
                h('ul', {}, a.notable.map((r) => h('li', {}, `${r.no}번 ${r.text} (사용자 − 팀원 ${r.userMinusTeam ?? '–'}, 사용자 − AI ${r.userMinusAi ?? '–'})`))))
            : h('p', {}, '사용자 점수와 팀원·AI 평가가 0.5점 이상 다른 문항은 없습니다.'),
          a.lowest.length ? h('div', {}, h('p', {}, '사용자 점수가 가장 낮은 문항:'), h('ul', {}, a.lowest.map((r) => h('li', {}, `${r.no}번 ${r.text} (${r.mean.toFixed(2)}점)`)))) : null)
      : null,

    a.groups.length
      ? h('div', {}, h('h3', {}, '영역별 비교'), h('div', { class: 'table-wrap' }, h('table', {},
          h('caption', { class: 'sr-only' }, '영역별 AI, 팀원, 사용자 평균 점수'),
          compareHead('영역'),
          h('tbody', {}, a.groups.map((g) => h('tr', {},
            h('th', { scope: 'row' }, `${g.name} (${g.questions}문항)`),
            h('td', { class: 'num' }, fmt(g.ai)), h('td', { class: 'num' }, fmt(g.team)), h('td', { class: 'num' }, fmt(g.user)),
            diffCell(g.userMinusAi), diffCell(g.userMinusTeam)))))))
      : null,

    h('h3', {}, '문항별 비교'),
    h('p', { class: 'legend', 'aria-hidden': 'true' }, h('span', { class: 'ai' }, 'AI'), h('span', { class: 'team' }, '팀원'), h('span', { class: 'user' }, '사용자'), ' 괄호 안은 응답 수'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('caption', { class: 'sr-only' }, '문항별 AI, 팀원, 사용자 평균 점수와 차이. 괄호 안은 응답 수'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '문항'),
        h('th', { scope: 'col', class: 'num' }, 'AI'),
        h('th', { scope: 'col', class: 'num' }, '팀원'),
        h('th', { scope: 'col', class: 'num' }, '사용자'),
        h('th', { scope: 'col', class: 'num' }, '사용자 만족 비율'),
        h('th', { scope: 'col', class: 'num' }, '사용자 − AI'),
        h('th', { scope: 'col', class: 'num' }, '사용자 − 팀원'))),
      h('tbody', {}, a.rows.map((r) => h('tr', {},
        h('th', { scope: 'row', style: 'font-weight:400' }, `${r.no}. ${r.text}`,
          r.aiDetail.length ? h('details', { class: 'no-print' }, h('summary', {}, 'AI 이유'),
            h('ul', {}, r.aiDetail.map((d) => h('li', {}, `${d.source}: ${d.score || '해당 없음'}${d.reason ? ` - ${d.reason}` : ''}`)))) : null,
          r.user.n ? h('details', { class: 'no-print' }, h('summary', {}, '사용자 점수 분포'),
            h('p', {}, [1, 2, 3, 4, 5].map((sc) => `${sc}점 ${r.user.dist[sc - 1]}명`).join(', ') + (r.user.na ? `, 해당 없음 ${r.user.na}명` : ''))) : null),
        scoreCell(r.ai, 'ai'), scoreCell(r.team, 'team'), scoreCell(r.user, 'user'),
        h('td', { class: 'num' }, pct(r.user.satisfied)),
        diffCell(r.userMinusAi), diffCell(r.userMinusTeam)))))),

    a.comments.length
      ? h('div', {}, h('h3', {}, `하고 싶은 말 (${a.comments.length}개)`),
          h('ul', {}, a.comments.map((c) => h('li', {}, h('strong', {}, `${c.role === 'team' ? '팀원' : '사용자'}: `), c.comment))))
      : null);
}

// ---------- 화면 나누기 ----------
async function route() {
  try {
    const { admin } = await api('/api/admin/session');
    if (!admin) return renderLogin();
    const m = location.hash.match(/^#\/s\/([A-Za-z0-9_-]+)$/);
    if (m) await renderSurvey(m[1]);
    else await renderList();
  } catch (e) {
    if (e.handled) return;
    show('오류', h('h1', {}, '불러오지 못했습니다'), h('p', {}, e.message), h('p', {}, h('a', { href: '#/' }, '설문 목록으로')));
  }
}

window.addEventListener('hashchange', route);
route();
