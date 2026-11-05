import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shopFile } from '../shop/serve.mjs';
import { PRODUCTS, productById } from '../mall/data.js';
import { addLine, missingOptions, orderNumber, totals, unitPrice, validateOrder } from '../mall/store.js';

const mallDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mall');
const line = (productId, choice, quantity = 1) => ({ productId, choice, quantity });

test('/mall/은 가상 쇼핑몰 파일을 내려주고, 폴더 밖이나 스크립트 원본은 거부한다', () => {
  assert.equal(shopFile('/mall/'), path.join(mallDir, 'index.html'));
  assert.equal(shopFile('/mall/store.js'), path.join(mallDir, 'store.js'));
  assert.equal(shopFile('/mall/../shop/index.html'), null);
  assert.equal(shopFile('/mall/%2e%2e/package.json'), null);
  assert.equal(shopFile('/mall/e2e-mall.mjs'), null);
});

test('상품 id가 겹치지 않고, 모든 상품에 사진 대체 텍스트와 옵션이 있다', () => {
  assert.equal(new Set(PRODUCTS.map((p) => p.id)).size, PRODUCTS.length);
  for (const p of PRODUCTS) {
    assert.ok(p.images.every((img) => img.alt), p.id);
    assert.ok(p.options.length && p.options.every((o) => o.values.some((v) => !v.soldOut)), p.id);
  }
});

test('모든 상품의 사진과 상세 이미지 파일이 있다', () => {
  for (const p of PRODUCTS) {
    assert.ok(p.detailImages?.length, `${p.id} 상세 이미지 없음`);
    for (const src of [...p.images.map((i) => i.src), ...p.detailImages]) {
      assert.ok(fs.existsSync(path.join(mallDir, src)), `${p.id}: ${src}`);
    }
  }
});

test('상세 이미지 원본에 적힌 옵션 이름은 상품 옵션과 같다', () => {
  const html = fs.readFileSync(path.join(mallDir, 'detail/detail.html'), 'utf8');
  for (const p of PRODUCTS.filter((p) => p.id !== 'tumbler')) {
    const block = html.slice(html.indexOf(`id="${p.id}-detail-01"`), html.indexOf(`id="${p.id}-detail-03"`));
    for (const o of p.options) for (const v of o.values) assert.ok(block.includes(v.name), `${p.id}: ${v.name}`);
  }
});

test('가격: 할인가와 옵션 추가 금액을 더한다', () => {
  assert.equal(unitPrice(productById('tumbler'), { 색상: '화이트' }), 24900);
  assert.equal(unitPrice(productById('bottle'), { 색상: '실버', 뚜껑: '빨대 뚜껑' }), 32900);
  assert.equal(unitPrice(productById('bottle'), { 색상: '실버', 뚜껑: '기본 뚜껑' }), 29900);
});

test('옵션을 다 고르지 않았거나 품절을 고르면 빠진 옵션으로 본다', () => {
  const bottle = productById('bottle');
  assert.deepEqual(missingOptions(bottle, {}), ['색상', '뚜껑']);
  assert.deepEqual(missingOptions(bottle, { 색상: '블랙' }), ['뚜껑']);
  assert.deepEqual(missingOptions(productById('tumbler'), { 색상: '세이지그린' }), ['색상']);
  assert.deepEqual(missingOptions(productById('socks'), { 사이즈: '250mm' }), []);
});

test('같은 상품·옵션은 한 줄로 합치고, 옵션이 다르면 따로 담는다', () => {
  let lines = addLine([], line('mug', { 색상: '아이보리' }, 1));
  lines = addLine(lines, line('mug', { 색상: '아이보리' }, 2));
  lines = addLine(lines, line('mug', { 색상: '네이비' }, 1));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].quantity, 3);
  assert.equal(addLine([{ ...lines[0], quantity: 98 }], line('mug', { 색상: '아이보리' }, 5))[0].quantity, 99);
});

test('배송비는 3만 원 미만이면 3,000원, 이상이면 무료', () => {
  const one = totals([line('mug', { 색상: '아이보리' }, 1)]);
  assert.deepEqual(one, { goods: 12900, discount: 0, shipping: 3000, total: 15900, count: 1 });
  const three = totals([line('tumbler', { 색상: '화이트' }, 3)]);
  assert.equal(three.goods, 74700);
  assert.equal(three.discount, (32000 - 24900) * 3);
  assert.equal(three.shipping, 0);
  assert.equal(totals([]).shipping, 0);
});

test('주문번호는 날짜-6자리', () => {
  assert.equal(orderNumber(new Date(2026, 10, 4), () => 0.0421), '20261104-042100');
});

const okForm = { ordererName: '김온글', ordererPhone: '010-1234-5678', addressType: 'saved', payment: 'card', cardCompany: '신한카드', agree: true };

test('주문서: 다 채우면 오류 없음', () => {
  assert.deepEqual(validateOrder(okForm), []);
});

test('주문서: 빈 칸과 틀린 형식을 입력칸 id와 함께 알려 준다', () => {
  const fields = (form) => validateOrder(form).map((e) => e.field);
  assert.deepEqual(fields({ addressType: 'saved', payment: 'card' }), ['orderer-name', 'orderer-phone', 'card-company', 'agree']);
  assert.deepEqual(fields({ ...okForm, ordererPhone: '1234' }), ['orderer-phone']);
  assert.deepEqual(fields({ ...okForm, addressType: 'new' }), ['ship-name', 'ship-phone', 'ship-zipcode', 'ship-detail']);
  assert.deepEqual(fields({ ...okForm, payment: 'bank' }), ['bank-name', 'depositor']);
  assert.deepEqual(fields({ ...okForm, payment: 'easy' }), ['easy-first']);
  assert.deepEqual(fields({ ...okForm, payment: 'phone' }), []);
});
