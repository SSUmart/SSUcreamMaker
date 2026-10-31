import { test } from 'node:test';
import assert from 'node:assert/strict';

// 파괴적 동작 교차 검증(finalLabel)은 요소 단서(hintsOf)만 쓴다. DOM 없이 단서를 바로 돌려주게 바꿔 시험한다
globalThis.__ongeul = { describe: { hintsOf: (el) => el.hints } };
await import('../content/reader/ai.js');
const { finalLabel } = globalThis.__ongeul.ai;
const el = (hints) => ({ hints });

test('파괴적 단서가 있는데 AI 이름에 그런 뜻이 없으면 용도 불명확으로 읽는다', () => {
  assert.equal(finalLabel(el('btn-delete icon-trash'), { label: '찜하기', confident: true }), '용도 불명확, delete 관련일 수 있음');
  assert.equal(finalLabel(el('btn-delete'), { label: '옵션 초기화', confident: true }), '옵션 초기화');
});

test('장바구니 비우기·전체 지우기 단서도 파괴적 동작으로 본다', () => {
  for (const hints of ['btn-clear-cart', 'empty_cart', 'cart-clear', 'basketEmpty', 'clear-all', 'btn-clearAll', '장바구니 비우기']) {
    assert.match(finalLabel(el(hints), { label: '찜하기', confident: true }), /^용도 불명확/, hints);
  }
  assert.equal(finalLabel(el('btn-clear-cart'), { label: '장바구니 비우기', confident: true }), '장바구니 비우기');
});

test('clearfix·is-empty처럼 흔한 클래스는 파괴적 단서로 보지 않는다', () => {
  for (const hints of ['clearfix btn-like', 'icon-btn is-empty', 'search-clear-icon']) {
    assert.equal(finalLabel(el(hints), { label: '좋아요', confident: true }), '좋아요', hints);
  }
  assert.equal(finalLabel(el('clearfix'), { label: '좋아요', confident: false }), '좋아요일 수 있음');
});
