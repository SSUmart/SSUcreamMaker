// 결과 페이지: <앞부분>/result-<순번>. 끝낸 설문의 분석표(AI·팀원·사용자 비교)를 따로 보여 준다.
// 관리자는 언제나 볼 수 있고, 그 밖의 사람은 관리자가 "결과 공개"를 켠 설문만 볼 수 있다.
import { $, BASE, api, fmtDate, h } from './common.js';
import { analysisView } from './analysis-view.js';

const main = $('#main');

function show(title, ...nodes) {
  document.title = `${title} - 온글 평가`;
  main.replaceChildren(...nodes.filter((node) => node != null && node !== false)); // null을 넘기면 "null" 글자로 그려지므로 뺀다
  const h1 = main.querySelector('h1');
  if (h1) {
    h1.tabIndex = -1;
    h1.focus();
  }
}

async function render() {
  const no = location.pathname.match(/\/result-([1-9]\d{0,6})$/)?.[1];
  try {
    if (!no) throw new Error('결과 주소가 올바르지 않습니다.');
    const r = await api(`/api/result/${no}`);
    const a = r.analysis;
    const title = r.preview ? `${r.title} 결과 미리보기` : `${r.title} 결과`;
    show(title,
      r.admin
        ? h('p', { class: 'no-print' }, h('a', { href: `${BASE}/admin#/s/${r.id}` }, '설문 관리로 돌아가기'))
        : null,
      h('h1', {}, title),
      r.preview
        ? h('div', { class: 'preview-box' },
            h('p', { style: 'margin:0;font-weight:700' }, '미리보기: 아직 진행 중인 설문입니다.'),
            h('p', { style: 'margin:4px 0 0' }, '지금까지 받은 응답으로 만든 분석표입니다. 응답이 더 들어오면 숫자가 바뀝니다. 관리자만 볼 수 있고, 결과를 공개해 두었더라도 다른 사람에게는 설문을 끝낸 뒤에 보입니다.'))
        : null,
      h('p', {}, h('span', { class: r.preview ? 'tag' : 'tag closed' }, r.preview ? '진행 중' : '종료'), ` 결과 ${r.no}번 · 문항 ${r.questions}개 · 팀원 응답 ${a.counts.team}개 · 사용자 응답 ${a.counts.user}개 · AI 답 ${a.counts.ai}개 · ${r.preview ? `만든 날 ${fmtDate(r.createdAt)}` : `끝낸 날 ${fmtDate(r.closedAt)}`}`),
      !r.preview && r.admin && !r.resultPublic
        ? h('p', { class: 'hint no-print' }, '이 결과는 아직 공개하지 않아 관리자만 볼 수 있습니다. 다른 사람에게 보여 주려면 설문 관리 화면에서 "결과 공개"를 켜세요.')
        : null,
      analysisView(a));
  } catch (e) {
    show('결과를 볼 수 없습니다', h('h1', {}, '결과를 볼 수 없습니다'), h('p', {}, e.message));
  }
}

render();
