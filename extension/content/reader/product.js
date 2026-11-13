// 상품 핵심 정보: 상품 페이지에서 상품명, 가격, 옵션, 수량, 구매·장바구니 버튼을 찾아 목록으로 보여 준다.
// 영역 표시(landmark)가 없는 복잡한 쇼핑몰에서 화살표를 수십 번 누르지 않고 바로 가게 한다 (설문 사용자 의견: 네이버 쇼핑 화살표 50번).
// 찾는 근거는 페이지의 구조화 데이터(schema.org Product, og: 메타)와 읽기 목록 항목의 이름·종류다. AI를 쓰지 않는다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.product) return;

  // 머리말·메뉴·바닥글의 장바구니 링크("장바구니 0") 같은 공통 메뉴는 상품 정보가 아니다
  const OUTSIDE = 'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';
  const PRICE = /(?:^|[^\d])(\d{1,3}(?:,\d{3})+|\d{3,})\s*원/;
  const BUY = /바로\s*구매|구매\s*하기|^구매$|바로\s*주문|주문\s*하기|^주문$|선물\s*하기/;
  const CART = /장바구니|카트에\s*담기|쇼핑백에\s*담기/;
  const NOT_ACTION = /후기|리뷰|문의|평점|내역|안내|방법/;
  const OPTION_WORD = /옵션|사이즈|크기|색상|컬러|색깔|용량|맛|선택/;
  const QUANTITY = /수량/;

  const squash = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();
  const inside = (item) => !item.el?.closest?.(OUTSIDE);

  // 같은 모양 버튼 2개 이상이 모여 있고 그 앞 글에 옵션을 뜻하는 말이 있으면 옵션 버튼 묶음으로 본다
  function optionGroupLabel(el) {
    const parent = el?.parentElement;
    const holder = parent && parent.tagName === 'LI' && parent.children.length === 1 ? parent : el;
    const box = holder?.parentElement;
    if (!box) return '';
    const peers = [...box.children].filter((child) => child.tagName === holder.tagName);
    if (peers.length < 2 || peers[0] !== holder) return '';
    const before = box.previousElementSibling?.textContent ?? box.getAttribute?.('aria-label') ?? '';
    const label = before.replace(/\s+/g, ' ').trim();
    return OPTION_WORD.test(label) && label.length <= 30 ? label : '';
  }

  // items: 읽기 목록 항목, meta: { name, price } (구조화 데이터에서 읽은 상품명·가격)
  // 돌려주는 값: [{ kind, label, item }] (종류 순서: 상품명, 가격, 옵션, 수량, 구매, 장바구니)
  function keyPoints(items, meta = {}) {
    const usable = items.filter(inside);
    const points = [];
    const add = (kind, label, item) => {
      if (item && !points.some((p) => p.item === item)) points.push({ kind, label, item });
    };

    // 상품명: 구조화 데이터의 상품명과 같은 제목, 없으면 첫 1수준 제목
    const headings = usable.filter((item) => item.category === 'heading' && item.name);
    const metaName = squash(meta.name);
    const named =
      (metaName.length >= 2 &&
        headings.find((item) => {
          const name = squash(item.name);
          return name.length >= 2 && (metaName.includes(name) || name.includes(metaName));
        })) ||
      headings.find((item) => item.level === 1);
    if (named) add('name', `상품명, ${named.name}`, named);

    // 가격: 상품명 뒤에서 처음 나오는 "○○원" 글. 구조화 데이터 가격이 있으면 그 숫자가 든 글을 먼저 찾는다
    const start = named ? usable.indexOf(named) : 0;
    const after = usable.slice(Math.max(start, 0));
    const priceText = (item) => (item.role === 'text' || item.category === 'other' ? item.phrase ?? item.name : '');
    const metaPrice = Number(meta.price);
    const formatted = Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice.toLocaleString('ko-KR') : '';
    const price =
      (formatted && after.find((item) => priceText(item).includes(formatted))) ||
      after.find((item) => PRICE.test(priceText(item)) && !/배송비/.test(priceText(item)));
    if (price) add('price', `가격, ${priceText(price)}`, price);

    // 옵션: 선택 상자, 라디오 묶음의 첫 칸, 옵션 버튼 묶음의 첫 버튼
    const seenRadio = new Set();
    for (const item of after) {
      if (['combobox', 'listbox'].includes(item.role) && !ns.model?.isEditField?.(item)) {
        add('option', `옵션, ${item.phrase}`, item);
      } else if (item.role === 'radio') {
        const group = item.el?.name || item.el?.closest?.('[role="radiogroup"], fieldset') || item;
        if (seenRadio.has(group)) continue;
        seenRadio.add(group);
        const legend = item.el?.closest?.('fieldset')?.querySelector?.('legend')?.textContent?.replace(/\s+/g, ' ').trim();
        add('option', `옵션, ${legend ? `${legend}, ` : ''}${item.phrase}`, item);
      } else if (item.category === 'button') {
        const label = optionGroupLabel(item.el);
        if (label) add('option', `옵션, ${label}, ${item.phrase}`, item);
      }
    }

    // 수량: 이름에 "수량"이 든 입력칸
    const quantity = after.find((item) => item.category === 'field' && QUANTITY.test(item.name));
    if (quantity) add('quantity', `수량, ${quantity.phrase}`, quantity);

    // 구매·장바구니: 이름으로 찾는다 ("구매 후기", "상품 문의" 같은 것은 뺀다)
    const actions = usable.filter((item) => ['button', 'link'].includes(item.category) && item.name && !NOT_ACTION.test(item.name));
    const buy = actions.find((item) => BUY.test(item.name));
    if (buy) add('buy', `구매, ${buy.phrase}`, buy);
    const cart = actions.find((item) => CART.test(item.name));
    if (cart) add('cart', `장바구니, ${cart.phrase}`, cart);

    const ORDER = ['name', 'price', 'option', 'quantity', 'buy', 'cart'];
    points.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    // 상품명도 구매 버튼도 없으면 상품 페이지로 보지 않는다
    return points.some((p) => p.kind === 'buy' || p.kind === 'cart' || p.kind === 'price') ? points : [];
  }

  // 페이지의 구조화 데이터에서 상품명과 가격을 읽는다 (JSON-LD schema.org Product, og: 메타)
  function pageMeta(doc = document) {
    const meta = {};
    const visit = (node) => {
      if (!node || typeof node !== 'object' || meta.name) return;
      if (Array.isArray(node)) return node.forEach(visit);
      const type = [].concat(node['@type'] ?? []);
      if (type.includes('Product')) {
        meta.name = node.name;
        const offer = [].concat(node.offers ?? [])[0];
        meta.price = offer?.price ?? offer?.lowPrice;
        return;
      }
      visit(node['@graph']);
    };
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent));
      } catch {
        // 깨진 구조화 데이터는 건너뛴다
      }
    }
    if (!meta.name) meta.name = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '';
    if (meta.price == null) meta.price = doc.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
    return meta;
  }

  ns.product = { keyPoints, pageMeta };
})();
