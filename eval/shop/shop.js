// 평가용 쇼핑몰 페이지의 동작: 상세 이미지 지연 로딩, 상품 사진 전환, 탭, 수량, 장바구니 안내.
// 평가 대상(상세 이미지)과 무관한 부분도 스크린리더로 실제처럼 조작할 수 있게 둔다.
(() => {
  // 지연 로딩: 화면 가까이 오면 data-src를 src로 옮긴다 (실제 쇼핑몰에서 흔한 방식)
  const lazyImages = document.querySelectorAll('img[data-src]');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.src = entry.target.dataset.src;
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '400px 0px' }
  );
  lazyImages.forEach((img) => observer.observe(img));

  // 상품 사진 전환
  const mainImage = document.getElementById('gallery-main');
  const thumbs = document.querySelectorAll('.thumbs button');
  thumbs.forEach((button) =>
    button.addEventListener('click', () => {
      mainImage.src = button.dataset.src;
      mainImage.alt = button.dataset.alt;
      thumbs.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    })
  );

  // 탭: 방향키·Home·End로 이동하고, 선택한 탭의 패널만 보인다 (WAI-ARIA 탭 패턴)
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = true) {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[(next + tabs.length) % tabs.length]);
    });
  });
  document.querySelectorAll('[data-open-tab]').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      selectTab(document.getElementById(link.dataset.openTab));
    })
  );

  // 수량과 총 금액
  const PRICE = 24900;
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  function clampQty(value) {
    return Math.min(Number(qty.max), Math.max(Number(qty.min), Math.round(value) || 1));
  }
  function updateTotal() {
    total.textContent = `${(PRICE * Number(qty.value)).toLocaleString('ko-KR')}원`;
  }
  document.querySelectorAll('[data-step]').forEach((button) =>
    button.addEventListener('click', () => {
      qty.value = clampQty(Number(qty.value) + Number(button.dataset.step));
      updateTotal();
    })
  );
  qty.addEventListener('change', () => {
    qty.value = clampQty(Number(qty.value));
    updateTotal();
  });

  // 찜하기 토글
  const wish = document.getElementById('wish');
  wish.addEventListener('click', () => {
    const pressed = wish.getAttribute('aria-pressed') !== 'true';
    wish.setAttribute('aria-pressed', String(pressed));
    say(pressed ? '찜 목록에 추가했습니다.' : '찜 목록에서 뺐습니다.');
  });

  // 장바구니·구매: 결과를 role=status 영역으로 알린다
  const status = document.getElementById('order-status');
  const cartCount = document.getElementById('cart-count');
  function say(text) {
    // 같은 문장도 다시 읽히도록 비운 뒤 채운다
    status.textContent = '';
    setTimeout(() => (status.textContent = text), 100);
  }
  document.getElementById('order').addEventListener('submit', (event) => {
    event.preventDefault();
    const color = new FormData(event.target).get('color');
    if (!color) {
      say('색상을 선택해 주세요.');
      event.target.querySelector('input[name="color"]').focus();
      return;
    }
    if (event.submitter?.value === 'buy') {
      say('평가용 페이지라 실제 구매는 되지 않습니다.');
      return;
    }
    cartCount.textContent = Number(cartCount.textContent) + Number(qty.value);
    say(`${color} ${qty.value}개를 장바구니에 담았습니다.`);
  });
})();
