import { test } from 'node:test';
import assert from 'node:assert/strict';

// 파괴적 동작 교차 검증(finalLabel)은 요소 단서(hintsOf)만 쓴다. DOM 없이 단서를 바로 돌려주게 바꿔 시험한다
globalThis.__ongeul = { describe: { hintsOf: (el) => el.hints } };
await import('../content/reader/ai.js');
const { finalLabel, hintName } = globalThis.__ongeul.ai;
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

// 요소 단서 글은 소문자이고 fooBar는 foo-bar로 나뉜 뒤 들어온다 (ai.js hintText)
test('흔한 아이콘 단서로 바로 이름을 붙인다', () => {
  assert.equal(hintName('cart-link /mall/cart.html', { role: 'link', counted: true }), '장바구니');
  assert.equal(hintName('cart-view /cart-view.pang', { role: 'link' }), '장바구니');
  assert.equal(hintName('btn-cart', { role: 'button' }), '장바구니 담기');
  assert.equal(hintName('header-basket', { role: 'button', counted: true }), '장바구니');
  assert.equal(hintName('wish wish-off', { role: 'button' }), '찜하기');
  assert.equal(hintName('btn_zzim', { role: 'button' }), '찜하기');
  assert.equal(hintName('icon-heart', { role: 'button' }), '찜하기');
  assert.equal(hintName('btn-share icon-btn', { role: 'button' }), '공유하기');
  assert.equal(hintName('search-close', { role: 'button' }), '닫기');
  assert.equal(hintName('btn-search #icon-magnifier', { role: 'button' }), '검색');
  assert.equal(hintName('top-btn', { role: 'button' }), '맨 위로');
  assert.equal(hintName('slick-next slick-arrow', { role: 'button' }), '다음');
  assert.equal(hintName('my-page /mypage', { role: 'link' }), '마이페이지');
});

test('뜻이 여럿이거나 다른 말의 일부인 단서로는 이름을 붙이지 않는다', () => {
  for (const hints of ['btn-like icon-btn', 'context-menu', 'display-flex', 'icon-btn', 'notice', 'clearfix', '']) {
    assert.equal(hintName(hints, { role: 'button' }), '', hints);
  }
});

test('삭제·결제 같은 되돌리기 어려운 동작 단서가 있으면 AI 교차 검증에 맡긴다', () => {
  for (const hints of ['cart-delete', 'btn-remove-wish', 'cart-clear', 'checkout-btn /checkout', 'search-close btn-delete']) {
    assert.equal(hintName(hints, { role: 'button' }), '', hints);
  }
});
