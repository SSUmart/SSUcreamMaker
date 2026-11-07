// 응답 화면과 관리자 화면이 함께 쓰는 도구. 글은 모두 textContent로 넣어 응답 내용이 HTML로 실행되지 않게 한다.
export const $ = (selector, root = document) => root.querySelector(selector);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (admin && method !== 'GET') headers['x-survey-admin'] = '1';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status, data });
  return data;
}

export const SCALE = [
  { score: 1, label: '매우 불만족' },
  { score: 2, label: '불만족' },
  { score: 3, label: '보통' },
  { score: 4, label: '만족' },
  { score: 5, label: '매우 만족' }
];

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
