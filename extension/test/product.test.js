import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../content/reader/product.js';

const { product } = globalThis.__ongeul;

// 읽기 목록 항목과 요소의 모양만 흉내 낸다. outside: 머리말·메뉴 안에 있는 요소
function el({ outside = false, tagName = 'BUTTON', parent = null } = {}) {
  return { tagName, parentElement: parent, closest: (selector) => (outside && selector.includes('header') ? {} : null) };
}
const heading = (name, level = 1, opts) => ({ role: 'heading', category: 'heading', name, level, phrase: `${name}, 제목 ${level}`, el: el(opts) });
const text = (phrase, opts) => ({ role: 'text', category: 'text', name: phrase, phrase, el: el(opts) });
const button = (name, opts) => ({ role: 'button', category: 'button', name, phrase: `${name}, 버튼`, el: el(opts) });
const link = (name, opts) => ({ role: 'link', category: 'link', name, phrase: `${name}, 링크`, el: el(opts) });
const select = (name) => ({ role: 'combobox', category: 'field', name, phrase: `${name}, 콤보 상자`, el: el({ tagName: 'SELECT' }) });
const spin = (name) => ({ role: 'spinbutton', category: 'field', name, phrase: `${name}, 숫자 편집창, 1`, el: el({ tagName: 'INPUT' }) });

test('상품명, 가격, 옵션, 수량, 구매, 장바구니를 이 순서로 찾는다', () => {
  const items = [
    link('장바구니 0', { outside: true }),
    heading('스텐 진공 텀블러'),
    text('판매가 24,900원'),
    select('색상'),
    spin('수량'),
    button('장바구니 담기'),
    button('바로 구매'),
    text('배송비 3,000원')
  ];
  const points = product.keyPoints(items);
  assert.deepEqual(points.map((p) => p.kind), ['name', 'price', 'option', 'quantity', 'buy', 'cart']);
  assert.equal(points[0].label, '상품명, 스텐 진공 텀블러');
  assert.equal(points[1].label, '가격, 판매가 24,900원');
  assert.equal(points[4].item, items[6]);
  assert.equal(points[5].item, items[5]);
});

test('머리말·메뉴의 장바구니 링크와 "구매 후기" 같은 것은 고르지 않는다', () => {
  const items = [link('장바구니', { outside: true }), heading('양말'), text('9,900원'), link('구매 후기 12개'), button('장바구니 담기')];
  const points = product.keyPoints(items);
  assert.equal(points.find((p) => p.kind === 'cart').item, items[4]);
  assert.equal(points.find((p) => p.kind === 'buy'), undefined);
});

test('구조화 데이터의 상품명·가격으로 찾는다 (첫 제목이 상품명이 아닐 때)', () => {
  const items = [heading('오늘의 특가'), text('추천 상품 12,000원'), heading('무선 이어폰 프로', 2), text('정가 89,000원'), text('할인가 69,000원'), button('구매하기')];
  const points = product.keyPoints(items, { name: '무선 이어폰 프로', price: '69000' });
  assert.equal(points.find((p) => p.kind === 'name').item, items[2]);
  assert.equal(points.find((p) => p.kind === 'price').item, items[4]);
});

test('가격·구매·장바구니가 하나도 없으면 상품 페이지로 보지 않는다', () => {
  assert.deepEqual(product.keyPoints([heading('공지사항'), text('안녕하세요'), link('다음 글')]), []);
});
