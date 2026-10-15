import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickKoreanVoice, timing } from '../lib/speech.js';

const mac = [
  { voiceName: 'Samantha', lang: 'en-US' },
  { voiceName: 'Eddy (한국어(대한민국))', lang: 'ko-KR' },
  { voiceName: 'Grandma (한국어(대한민국))', lang: 'ko-KR' },
  { voiceName: '유나', lang: 'ko-KR' }
];
const windows = [
  { voiceName: 'Microsoft Heami - Korean (Korean)', lang: 'ko-KR' },
  { voiceName: 'Google 한국의', lang: 'ko-KR', remote: true }
];

test('음성 고르기: 운영체제 기본 한국어 음성을 재미용 음성보다 먼저', () => {
  assert.equal(pickKoreanVoice(mac).voiceName, '유나');
  assert.equal(pickKoreanVoice(windows).voiceName, 'Microsoft Heami - Korean (Korean)');
});

test('음성 고르기: 사용자가 고른 음성 우선, 없는 이름이면 기본으로', () => {
  assert.equal(pickKoreanVoice(mac, 'Grandma (한국어(대한민국))').voiceName, 'Grandma (한국어(대한민국))');
  assert.equal(pickKoreanVoice(mac, '없는 음성').voiceName, '유나');
});

test('음성 고르기: 인터넷 음성은 직접 고를 때만, 기기 음성이 없으면 null', () => {
  assert.equal(pickKoreanVoice([{ voiceName: 'A', lang: 'ko-KR', remote: true }, { voiceName: 'B', lang: 'ko' }]).voiceName, 'B');
  assert.equal(pickKoreanVoice([{ voiceName: 'Google 한국의', lang: 'ko-KR', remote: true }]), null);
  assert.equal(
    pickKoreanVoice([{ voiceName: 'Google 한국의', lang: 'ko-KR', remote: true }], 'Google 한국의').voiceName,
    'Google 한국의'
  );
  assert.equal(pickKoreanVoice([{ voiceName: 'Samantha', lang: 'en-US' }]), null);
});

test('시간 계산: 시작부터 끝(또는 끊김)까지', () => {
  const result = { events: [{ type: 'start', ms: 10 }, { type: 'word', ms: 50 }, { type: 'interrupted', ms: 900 }] };
  assert.deepEqual(timing(result), { start: 10, end: 900, duration: 890 });
  assert.deepEqual(timing({ events: [] }), { start: null, end: null, duration: null });
});
