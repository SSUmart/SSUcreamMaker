// 분석표 화면: 결과 페이지(result.js)가 쓴다. 글은 모두 textContent로 넣어 응답 내용(하고 싶은 말 등)이 HTML로 실행되지 않게 한다.
import { h } from './common.js';

const ROLE = { ai: 'AI 평가', team: '팀원 평가', user: '사용자 평가' };
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

export function analysisView(a) {
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
