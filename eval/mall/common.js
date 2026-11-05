// 모든 페이지가 같이 쓰는 머리글·바닥글. 페이지에는 <div id="site-header"></div>, <div id="site-footer"></div>만 둔다.
// [접근성 문제] 표시가 붙은 곳은 실제 국내 쇼핑몰에 흔한 문제를 일부러 넣은 것이다 (README의 "일부러 넣은 접근성 문제").
import { CATEGORIES } from './data.js';
import { cart } from './store.js';

export const $ = (selector, root = document) => root.querySelector(selector);

// 태그 만들기: h('button', { class: 'x', onclick }, '글자', 자식요소...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const CART_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11.2L21 7H7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="19" r="1.6"/><circle cx="18" cy="19" r="1.6"/></svg>';

export function renderHeader({ category = '', query = '' } = {}) {
  const count = cart.lines().reduce((n, line) => n + line.quantity, 0);
  const header = h(
    'header',
    // 같은 id를 달아 두어 장바구니 개수가 바뀔 때 다시 그릴 수 있게 한다
    { class: 'site-header', id: 'site-header' },
    h('a', { class: 'skip-link', href: '#main' }, '본문 바로가기'),
    h('p', { class: 'notice-bar' }, '가상 쇼핑몰 테스트 페이지입니다. 실제로 주문·결제되지 않습니다.'),
    h(
      'div',
      { class: 'header-inner' },
      h('a', { class: 'logo', href: 'index.html' }, '온글몰'),
      h(
        'form',
        { class: 'search', role: 'search', action: 'index.html' },
        h('label', { for: 'search-q', class: 'sr-only' }, '상품 검색'),
        h('input', { id: 'search-q', name: 'q', type: 'search', placeholder: '찾는 상품을 입력하세요', value: query }),
        h('button', { type: 'submit' }, '검색')
      ),
      // [접근성 문제] 장바구니 아이콘 링크의 이름이 담은 개수 숫자뿐이다 (스크린리더는 "0, 링크"처럼 읽어 무슨 링크인지 알 수 없음)
      h('a', { class: 'cart-link', href: 'cart.html', html: `${CART_ICON}<span class="badge">${count}</span>` })
    ),
    h(
      'nav',
      { class: 'gnb', 'aria-label': '상품 분류' },
      h(
        'ul',
        {},
        CATEGORIES.map((c) =>
          h('li', {}, h('a', { href: c.id === 'all' ? 'index.html' : `index.html?category=${c.id}`, 'aria-current': c.id === (category || 'all') && !query ? 'page' : null }, c.name))
        )
      )
    )
  );
  $('#site-header').replaceWith(header);
}

export function renderFooter() {
  $('#site-footer').replaceWith(
    h(
      'footer',
      { class: 'site-footer', id: 'site-footer' },
      h('p', {}, '온글몰은 온글 스크린리더 시험용 가상 쇼핑몰입니다. 상품, 가격, 주문, 결제는 모두 가상이며 실제로 처리되지 않습니다.'),
      h('p', {}, '고객센터 1588-0000 (가상) · 평일 09:00~18:00')
    )
  );
}

// [접근성 문제] 화면에만 잠깐 보이고 사라지는 알림 (실시간 알림 영역이 아니라 스크린리더가 읽지 않음)
export function toast(message, link) {
  document.querySelector('.toast')?.remove();
  const box = h('div', { class: 'toast' }, h('span', {}, message), link && h('a', { href: link.href }, link.text));
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}
