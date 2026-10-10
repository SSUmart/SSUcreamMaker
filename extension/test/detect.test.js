import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDetailImages } from '../lib/detect.js';

const img = (url, width, height) => ({ url, width, height });

test('세로로 긴 이미지를 고른다', () => {
  const picked = pickDetailImages([img('tall', 860, 3000), img('square', 1000, 1000)]);
  assert.deepEqual(picked.map((i) => i.url), ['tall']);
});

test('같은 너비로 이어 붙인 3장 이상을 묶음으로 고른다', () => {
  const picked = pickDetailImages([
    img('a', 860, 700),
    img('b', 860, 800),
    img('c', 862, 600),
    img('photo', 1000, 1000)
  ]);
  assert.deepEqual(picked.map((i) => i.url), ['a', 'b', 'c']);
});

test('좁은 이미지는 세로로 길어도 제외한다', () => {
  assert.deepEqual(pickDetailImages([img('narrow', 200, 2000)]), []);
});
