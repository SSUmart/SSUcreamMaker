import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEMO_DATA } from '../lib/demo-data.js';
import { demoDetail, demoPageKey, demoSummary } from '../lib/demo.js';

const HOST = 'https://ssu.jaymong.me';
const data = {
  pages: {
    '/mall/product.html?id=mug': {
      detail: { images: ['/mall/images/mug-detail-01.jpg', '/mall/images/mug-detail-02.jpg'], sections: [{ title: '가격·할인', items: ['18,000원'] }] },
      summary: { overview: '머그컵입니다.', items: [{ text: '판매가 18,000원', sourceTexts: ['판매가 18,000원', '없어진 문단'] }] }
    }
  }
};
const page = `${HOST}/mall/product.html?id=mug`;
const urls = [`${HOST}/mall/images/mug-ivory.jpg`, `${HOST}/mall/images/mug-detail-01.jpg`];

test('테스트 서버의 /mall/, /shop/ 페이지에만 저장 결과를 쓴다', () => {
  assert.equal(demoPageKey(page), '/mall/product.html?id=mug');
  assert.equal(demoPageKey(`${HOST}/shop/index.html#top`), '/shop/');
  assert.equal(demoPageKey(`${HOST}/mall/`), '/mall/');
  for (const other of [`${HOST}/survey/`, `${HOST}/guide/`, 'http://127.0.0.1:8080/mall/product.html?id=mug', 'https://ssu.jaymong.me.evil.test/mall/', 'https://evil.test/mall/?u=ssu.jaymong.me', 'not a url', undefined]) {
    assert.equal(demoPageKey(other), null, String(other));
  }
});

test('상세 이미지: 저장 결과를 페이지의 이미지 위치와 함께 돌려준다', () => {
  assert.deepEqual(demoDetail(page, urls, data), {
    sections: data.pages['/mall/product.html?id=mug'].detail.sections,
    imageCount: 2,
    firstUrl: urls[1],
    truncated: false,
    failedCount: 0
  });
});

test('상세 이미지: 저장 결과가 없거나 이미지가 보이지 않으면 원래 길로 간다', () => {
  assert.equal(demoDetail(`${HOST}/mall/product.html?id=socks`, urls, data), null);
  assert.equal(demoDetail(page, [`${HOST}/mall/images/mug-ivory.jpg`], data), null);
  assert.equal(demoDetail('http://127.0.0.1:8080/mall/product.html?id=mug', urls, data), null);
});

test('요약: 근거 문단을 지금 페이지의 번호로 바꾸고, 없어진 문단은 뺀다', () => {
  const result = demoSummary(page, { paragraphs: ['상세 이미지 상자', '판매가 18,000원'] }, data);
  assert.deepEqual(result, { overview: '머그컵입니다.', items: [{ text: '판매가 18,000원', sources: [2] }] });
  assert.equal(demoSummary(`${HOST}/mall/cart.html`, { paragraphs: [] }, data), null);
});

test('온글몰 상품 6개의 상세 이미지 결과가 저장되어 있고, ssu.jaymong.me에서만 나온다', () => {
  for (const id of ['tumbler', 'mug', 'bottle', 'ecobag', 'socks', 'earphone']) {
    const { images } = DEMO_DATA.pages[`/mall/product.html?id=${id}`].detail;
    const urls = images.map((image) => `${HOST}${image}`);
    assert.ok(demoDetail(`${HOST}/mall/product.html?id=${id}`, urls).sections.length > 0, id);
    assert.equal(demoDetail(`http://127.0.0.1:8080/mall/product.html?id=${id}`, urls), null, id);
    assert.equal(demoDetail(`https://www.ssu.jaymong.me/mall/product.html?id=${id}`, urls), null, id);
  }
});

test('저장된 상세 이미지는 테스트 페이지에 실제로 있는 파일이다', () => {
  for (const [key, record] of Object.entries(DEMO_DATA.pages)) {
    for (const image of record.detail?.images ?? []) {
      assert.ok(fs.existsSync(new URL(`../../eval${image}`, import.meta.url)), `${key}: ${image}`);
    }
  }
});
