import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shopFile } from '../shop/serve.mjs';
import { normalize } from '../score.js';

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shopDir = path.join(evalDir, 'shop');

test('/shop/은 index.html을 내려준다', () => {
  assert.equal(shopFile('/shop/'), path.join(shopDir, 'index.html'));
  assert.equal(shopFile('/shop/images/detail-01.jpg'), path.join(shopDir, 'images/detail-01.jpg'));
});

test('/guide/는 설치 가이드와 그림을 내려주고, 화면 찍는 스크립트는 내려주지 않는다', () => {
  const guideDir = path.join(evalDir, 'guide');
  assert.equal(shopFile('/guide/'), path.join(guideDir, 'index.html'));
  assert.equal(shopFile('/guide/images/options-done.png'), path.join(guideDir, 'images/options-done.png'));
  assert.equal(shopFile('/guide/capture-screens.mjs'), null);
  assert.equal(shopFile('/guide/../web.mjs'), null);
  for (const src of fs.readFileSync(path.join(guideDir, 'index.html'), 'utf8').matchAll(/(?:src|href)="((?:images\/)?[\w.-]+\.(?:png|jpg|css|js))"/g)) {
    assert.ok(fs.existsSync(path.join(guideDir, src[1])), `가이드가 쓰는 파일이 없음: ${src[1]}`);
  }
});

test('shop 폴더 밖이나 내려줄 종류가 아닌 파일은 거부한다', () => {
  assert.equal(shopFile('/shop/../package.json'), null);
  assert.equal(shopFile('/shop/%2e%2e/run.mjs'), null);
  assert.equal(shopFile('/shop/serve.mjs'), null);
  assert.equal(shopFile('/shop/%E0%A4%A'), null);
  assert.equal(shopFile('/other/index.html'), null);
});

test('shop-tumbler 정답 문구는 모두 상세 이미지 원본에 적혀 있다', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(evalDir, 'cases.json'), 'utf8'));
  const { expect } = cases.find((c) => c.id === 'shop-tumbler');
  const html = fs.readFileSync(path.join(shopDir, 'detail/detail.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>'));
  const text = normalize(body.replace(/<[^>]+>/g, ' '));
  for (const fact of Object.values(expect).flat()) {
    assert.ok(text.includes(normalize(fact)), `상세 이미지에 없는 정답: ${fact}`);
  }
});
