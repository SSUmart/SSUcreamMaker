import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../content/reader/input-language.js';

const { inputLanguage } = globalThis.__ongeul;
const key = (props) => ({ key: '', code: '', keyCode: 0, ...props });

test('한/영 키를 알아본다 (한/영 키, 오른쪽 Alt 한/영, 입력기가 먼저 처리한 경우)', () => {
  assert.equal(inputLanguage.isToggleKey(key({ key: 'HangulMode', code: 'Lang1' }), { mac: false }), true);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'HangulMode', code: 'AltRight' })), true);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'Process', code: 'Lang1', keyCode: 229 })), true);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'Process', code: 'AltRight', keyCode: 229 })), true);
});

test('한/영 키가 아닌 키와 누르고 있는 반복 입력은 한/영 키로 보지 않는다', () => {
  assert.equal(inputLanguage.isToggleKey(key({ key: 'Alt', code: 'AltRight' })), false);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'Process', code: 'KeyA', keyCode: 229 })), false);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'HanjaMode', code: 'Lang2' })), false);
  assert.equal(inputLanguage.isToggleKey(key({ key: 'HangulMode', code: 'Lang1', repeat: true })), false);
});

test('누른 글자로 입력 언어를 알아낸다', () => {
  assert.equal(inputLanguage.languageOf(key({ key: 'Process', code: 'KeyA', keyCode: 229 })), 'ko');
  assert.equal(inputLanguage.languageOf(key({ key: 'ㅁ', code: 'KeyA' })), 'ko');
  assert.equal(inputLanguage.languageOf(key({ key: 'ㅏ', code: 'KeyK', isComposing: true })), 'ko');
  assert.equal(inputLanguage.languageOf(key({ key: 'a', code: 'KeyA' })), 'en');
  assert.equal(inputLanguage.languageOf(key({ key: 'A', code: 'KeyA', shiftKey: true })), 'en');
});

test('언어와 관계없는 키는 판단하지 않는다', () => {
  for (const props of [
    { key: '1', code: 'Digit1' },
    { key: ' ', code: 'Space' },
    { key: 'Enter', code: 'Enter' },
    { key: 'Backspace', code: 'Backspace' },
    { key: 'a', code: 'KeyA', ctrlKey: true },
    { key: 'v', code: 'KeyV', metaKey: true }
  ]) {
    assert.equal(inputLanguage.languageOf(key(props)), null, JSON.stringify(props));
  }
});

test('언어를 알면 한/영 키를 누를 때마다 바뀐 언어를 읽는다', () => {
  const tracker = inputLanguage.createTracker('en');
  assert.equal(tracker.toggle(), '한글 입력');
  assert.equal(tracker.toggle(), '영어 입력');
  assert.equal(tracker.language, 'en');
});

test('언어를 모르면 전환만 알리고, 다음 글자를 입력할 때 한 번 언어를 읽는다', () => {
  const tracker = inputLanguage.createTracker();
  assert.equal(tracker.toggle(), inputLanguage.UNKNOWN);
  assert.equal(tracker.learn(key({ key: '1', code: 'Digit1' })), null);
  assert.equal(tracker.learn(key({ key: 'Process', code: 'KeyG', keyCode: 229 })), '한글 입력');
  // 그다음 글자부터는 읽지 않는다 (입력할 때마다 말하지 않게)
  assert.equal(tracker.learn(key({ key: 'Process', code: 'KeyK', keyCode: 229 })), null);
  assert.equal(tracker.toggle(), '영어 입력');
});

test('입력한 글자가 알고 있던 언어와 다르면 조용히 고쳐 둔다 (다른 방법으로 언어를 바꾼 경우)', () => {
  const tracker = inputLanguage.createTracker('ko');
  assert.equal(tracker.learn(key({ key: 'a', code: 'KeyA' })), null);
  assert.equal(tracker.language, 'en');
  assert.equal(tracker.toggle(), '한글 입력');
});

test('저장된 언어로 시작할 때 알 수 없는 값은 무시한다', () => {
  const tracker = inputLanguage.createTracker();
  tracker.set(undefined);
  tracker.set('ja');
  assert.equal(tracker.language, null);
  tracker.set('ko');
  assert.equal(tracker.toggle(), '영어 입력');
});

test('macOS에서는 Caps Lock을 한/영 키로 보고, Windows에서는 보지 않는다', () => {
  const caps = key({ key: 'CapsLock', code: 'CapsLock' });
  assert.equal(inputLanguage.isToggleKey(caps, { mac: true }), true);
  assert.equal(inputLanguage.isToggleKey(caps, { mac: false }), false);
  assert.equal(inputLanguage.isToggleKey({ ...caps, repeat: true }, { mac: true }), false);
});

test('Caps Lock 한 번 누름은 keydown과 keyup이 둘 다 와도, 하나만 와도 한 번으로 센다', () => {
  const down = key({ type: 'keydown', key: 'CapsLock', code: 'CapsLock' });
  const up = key({ type: 'keyup', key: 'CapsLock', code: 'CapsLock' });
  // 둘 다 오는 경우
  const both = inputLanguage.createTracker('en');
  assert.equal(both.press(down, 1000), '한글 입력');
  assert.equal(both.press(up, 1100), null);
  assert.equal(both.press(down, 3000), '영어 입력');
  assert.equal(both.press(up, 3100), null);
  // keyup만 오는 경우
  const upOnly = inputLanguage.createTracker('en');
  assert.equal(upOnly.press(up, 1000), '한글 입력');
  assert.equal(upOnly.press(up, 1500), '영어 입력');
  // keydown만 오는 경우
  const downOnly = inputLanguage.createTracker('en');
  assert.equal(downOnly.press(down, 1000), '한글 입력');
  assert.equal(downOnly.press(down, 1500), '영어 입력');
});

test('한/영 키 한 번에 keydown이 겹쳐 오면 한 번으로 센다', () => {
  const tracker = inputLanguage.createTracker('en');
  const down = key({ type: 'keydown', key: 'HangulMode', code: 'Lang1' });
  assert.equal(tracker.press(down, 1000), '한글 입력');
  assert.equal(tracker.press(down, 1030), null);
  assert.equal(tracker.press(down, 1300), '영어 입력');
});

test('Caps Lock이 켜져 있을 때 입력한 대문자로는 언어를 판단하지 않는다', () => {
  const upper = key({ key: 'A', code: 'KeyA', getModifierState: (name) => name === 'CapsLock' });
  assert.equal(inputLanguage.languageOf(upper), null);
});

test('한/영 키 뒤 읽어 준 언어와 실제 입력이 다르면 다음 글자에서 바로잡아 읽는다', () => {
  const tracker = inputLanguage.createTracker('ko');
  assert.equal(tracker.toggle(0), '영어 입력');
  assert.equal(tracker.learn(key({ key: 'Process', code: 'KeyA', keyCode: 229 }), 100), '한글 입력');
  // 한 번 바로잡은 뒤로는 읽지 않는다
  assert.equal(tracker.learn(key({ key: 'Process', code: 'KeyS', keyCode: 229 }), 200), null);
  // 맞게 읽어 준 경우는 조용히 넘어간다
  assert.equal(tracker.toggle(300), '영어 입력');
  assert.equal(tracker.learn(key({ key: 'a', code: 'KeyA' }), 400), null);
});

test('언어를 몰라 기다리는 것은 잠시뿐이다 (한참 뒤 입력한 글자로 읽던 내용을 끊지 않게)', () => {
  const tracker = inputLanguage.createTracker();
  assert.equal(tracker.toggle(0), inputLanguage.UNKNOWN);
  assert.equal(tracker.learn(key({ key: 'a', code: 'KeyA' }), 60_000), null);
  assert.equal(tracker.language, 'en');
});

test('온글을 끄면 입력 언어를 모르는 상태로 돌아간다', () => {
  const tracker = inputLanguage.createTracker('ko');
  tracker.reset();
  assert.equal(tracker.language, null);
  assert.equal(tracker.toggle(0), inputLanguage.UNKNOWN);
});
