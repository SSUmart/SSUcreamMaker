import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewTabUrl, shouldRedirectNewTab } from '../lib/newtab.js';
import { mergeSettings } from '../lib/settings.js';

test('크롬 기본 새 탭 주소를 알아본다', () => {
  assert.equal(isNewTabUrl('chrome://newtab/'), true);
  assert.equal(isNewTabUrl('chrome://new-tab-page/'), true);
  assert.equal(isNewTabUrl('chrome-search://local-ntp/local-ntp.html'), true);
  assert.equal(isNewTabUrl('chrome://newtab'), true);
});

test('새 탭이 아닌 주소는 옮기지 않는다', () => {
  assert.equal(isNewTabUrl('chrome://extensions/'), false);
  assert.equal(isNewTabUrl('chrome://newtab-like/'), false);
  assert.equal(isNewTabUrl('https://www.google.com/'), false);
  assert.equal(isNewTabUrl('https://example.com/chrome://newtab/'), false);
  assert.equal(isNewTabUrl(undefined), false);
});

test('기본 설정은 새 탭을 google.com으로 옮기고, 크롬 기본 새 탭을 고르면 옮기지 않는다', () => {
  assert.equal(mergeSettings({}).reader.newTab, 'google');
  assert.equal(shouldRedirectNewTab('chrome://newtab/', mergeSettings({})), true);
  assert.equal(shouldRedirectNewTab('chrome://newtab/', mergeSettings({ reader: { newTab: 'chrome' } })), false);
  assert.equal(shouldRedirectNewTab('https://naver.com/', mergeSettings({})), false);
});
