import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../content/reader/model.js';

const { model } = globalThis.__ongeul;

// E 키 판단에 쓰는 요소의 모양만 흉내 낸다 (tagName, type 속성, contenteditable)
function el(tagName, { type, editable = false } = {}) {
  return { tagName, isContentEditable: editable, getAttribute: (name) => (name === 'type' ? (type ?? null) : null) };
}
const item = (role, element) => ({ role, el: element });

test('일반 편집창은 E 키로 찾는다', () => {
  assert.equal(model.isEditField(item('textbox', el('INPUT', { type: 'text' }))), true);
  assert.equal(model.isEditField(item('searchbox', el('INPUT', { type: 'search' }))), true);
  assert.equal(model.isEditField(item('password', el('INPUT', { type: 'password' }))), true);
  assert.equal(model.isEditField(item('textbox', el('TEXTAREA'))), true);
});

test('role="combobox"를 단 자동완성 검색창도 E 키로 찾는다 (네이버·유튜브 검색창)', () => {
  // 네이버: <input id="query" type="search" role="combobox">
  assert.equal(model.isEditField(item('combobox', el('INPUT', { type: 'search' }))), true);
  // 유튜브: <input name="search_query" role="combobox"> (type 없음 = text)
  assert.equal(model.isEditField(item('combobox', el('INPUT'))), true);
  assert.equal(model.isEditField(item('combobox', el('TEXTAREA'))), true);
  assert.equal(model.isEditField(item('combobox', el('DIV', { editable: true }))), true);
});

test('글자를 입력하지 않는 콤보 상자는 E 키로 찾지 않는다 (C 키로 찾음)', () => {
  assert.equal(model.isEditField(item('combobox', el('SELECT'))), false);
  assert.equal(model.isEditField(item('combobox', el('BUTTON'))), false);
  assert.equal(model.isEditField(item('combobox', el('DIV'))), false);
  assert.equal(model.isEditField(item('combobox', el('INPUT', { type: 'checkbox' }))), false);
  assert.equal(model.isEditField(item('listbox', el('SELECT'))), false);
  assert.equal(model.isEditField(item('button', el('BUTTON'))), false);
});
