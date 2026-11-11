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

test('/info/는 공유 페이지와 그림을 내려주고, 폴더 밖은 거부한다', () => {
  const infoDir = path.join(evalDir, 'info');
  assert.equal(shopFile('/info/'), path.join(infoDir, 'index.html'));
  assert.equal(shopFile('/info/images/tiles.jpg'), path.join(infoDir, 'images/tiles.jpg'));
  assert.equal(shopFile('/info/../web.mjs'), null);
  const html = fs.readFileSync(path.join(infoDir, 'index.html'), 'utf8');
  const files = [...html.matchAll(/(?:src|href)="((?:images\/)?[\w.-]+\.(?:png|jpg|css|js))"/g)].map((m) => m[1]);
  assert.ok(files.length >= 8, '공유 페이지가 쓰는 그림·스타일을 찾지 못함');
  for (const f of files) assert.ok(fs.existsSync(path.join(infoDir, f)), `공유 페이지가 쓰는 파일이 없음: ${f}`);
  // 그림 7장은 모두 설명 그림이라 본문이 내용을 전하고, 스크린리더가 파일 이름을 읽지 않도록 alt를 비운다
  for (const img of html.matchAll(/<img [^>]*>/g)) assert.match(img[0], /alt=""/);
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
