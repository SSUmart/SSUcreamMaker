import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTiles, arrayBufferToBase64, TILE_OVERLAP } from '../lib/tiles.js';

test('짧은 이미지는 조각 하나', () => {
  assert.deepEqual(planTiles(860, 600), { scale: 1, tiles: [{ y: 0, height: 600 }] });
});

test('긴 이미지는 겹치며 끝까지 덮는다', () => {
  const { tiles } = planTiles(860, 3000);
  assert.equal(tiles[0].y, 0);
  for (let i = 1; i < tiles.length; i++) {
    assert.equal(tiles[i - 1].y + tiles[i - 1].height - tiles[i].y, TILE_OVERLAP);
  }
  const last = tiles.at(-1);
  assert.equal(last.y + last.height, 3000);
});

test('넓은 이미지는 축소 비율을 반영해 원본 좌표로 계산한다', () => {
  const { scale, tiles } = planTiles(2000, 2000);
  assert.equal(scale, 0.5);
  assert.equal(tiles[0].height, 2000);
  assert.equal(tiles.length, 1);
});

test('base64 인코딩', () => {
  const bytes = new TextEncoder().encode('상세 이미지');
  assert.equal(arrayBufferToBase64(bytes.buffer), Buffer.from(bytes).toString('base64'));
});
