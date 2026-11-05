// 장바구니와 주문 계산. 계산 함수는 저장소와 떼어 두어 테스트(eval/test/mall.test.js)에서 바로 쓴다.
// 장바구니는 localStorage, 마지막 주문과 바로 구매는 sessionStorage에 둔다 (서버로 보내지 않음).
import { FREE_SHIPPING_MIN, SHIPPING_FEE, productById } from './data.js';

const CART_KEY = 'ongeul-mall-cart';
const BUY_NOW_KEY = 'ongeul-mall-buy-now';
const ORDER_KEY = 'ongeul-mall-last-order';

export const won = (n) => `${n.toLocaleString('ko-KR')}원`;

// 상품 한 개 가격 (할인가 + 옵션 추가 금액)
export function unitPrice(product, choice = {}) {
  const base = product.salePrice ?? product.price;
  const extra = product.options.reduce((sum, option) => {
    const value = option.values.find((v) => v.name === choice[option.name]);
    return sum + (value?.extra ?? 0);
  }, 0);
  return base + extra;
}

// 옵션을 다 골랐는지. 빠진 옵션 이름 목록 (품절을 고른 것도 빠진 것으로 본다)
export function missingOptions(product, choice = {}) {
  return product.options
    .filter((option) => {
      const value = option.values.find((v) => v.name === choice[option.name]);
      return !value || value.soldOut;
    })
    .map((option) => option.name);
}

export function optionText(choice = {}) {
  return Object.entries(choice)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
}

// 같은 상품·같은 옵션이면 한 줄로 합친다
export function lineKey(productId, choice = {}) {
  return `${productId}|${optionText(choice)}`;
}

export function addLine(lines, { productId, choice, quantity }) {
  const key = lineKey(productId, choice);
  const found = lines.find((line) => line.key === key);
  if (found) return lines.map((line) => (line === found ? { ...line, quantity: Math.min(99, line.quantity + quantity) } : line));
  return [...lines, { key, productId, choice, quantity, selected: true }];
}

// 주문 금액: 상품 금액, 할인 금액(정가 대비), 배송비(3만 원 이상 무료), 결제 금액
export function totals(lines) {
  let goods = 0;
  let listPrice = 0;
  for (const line of lines) {
    const product = productById(line.productId);
    if (!product) continue;
    goods += unitPrice(product, line.choice) * line.quantity;
    listPrice += (unitPrice(product, line.choice) + product.price - (product.salePrice ?? product.price)) * line.quantity;
  }
  const shipping = goods === 0 || goods >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
  return { goods, discount: listPrice - goods, shipping, total: goods + shipping, count: lines.reduce((n, l) => n + l.quantity, 0) };
}

// 가상 주문번호: 날짜 + 6자리
export function orderNumber(date = new Date(), random = Math.random) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${String(Math.floor(random() * 1e6)).padStart(6, '0')}`;
}

// 주문서 확인. 빠지거나 틀린 항목마다 { field, message } (field는 입력칸 id)
export function validateOrder(form) {
  const errors = [];
  const need = (field, ok, message) => !ok && errors.push({ field, message });
  need('orderer-name', form.ordererName?.trim(), '주문하는 분 이름을 입력해 주세요.');
  need('orderer-phone', /^01\d-?\d{3,4}-?\d{4}$/.test(form.ordererPhone?.trim() ?? ''), '주문하는 분 휴대폰 번호를 010-1234-5678 형식으로 입력해 주세요.');
  if (form.addressType === 'new') {
    need('ship-name', form.shipName?.trim(), '받는 분 이름을 입력해 주세요.');
    need('ship-phone', /^01\d-?\d{3,4}-?\d{4}$/.test(form.shipPhone?.trim() ?? ''), '받는 분 휴대폰 번호를 010-1234-5678 형식으로 입력해 주세요.');
    need('ship-zipcode', /^\d{5}$/.test(form.zipcode ?? ''), '우편번호 찾기로 주소를 골라 주세요.');
    need('ship-detail', form.detail?.trim(), '상세 주소를 입력해 주세요.');
  }
  need('pay-card', form.payment, '결제수단을 골라 주세요.');
  if (form.payment === 'card') need('card-company', form.cardCompany, '카드사를 골라 주세요.');
  if (form.payment === 'bank') {
    need('bank-name', form.bank, '입금할 은행을 골라 주세요.');
    need('depositor', form.depositor?.trim(), '입금자 이름을 입력해 주세요.');
  }
  if (form.payment === 'easy') need('easy-first', form.easyPay, '간편결제 서비스를 골라 주세요.');
  need('agree', form.agree, '주문 내용 확인 및 결제 진행에 동의해 주세요.');
  return errors;
}

// ----- 브라우저 저장소 -----
const read = (storage, key, fallback) => {
  try {
    return JSON.parse(storage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

export const cart = {
  lines: () => read(localStorage, CART_KEY, []),
  save: (lines) => localStorage.setItem(CART_KEY, JSON.stringify(lines)),
  add(item) {
    this.save(addLine(this.lines(), item));
  },
  clear: () => localStorage.removeItem(CART_KEY)
};

export const buyNow = {
  get: () => read(sessionStorage, BUY_NOW_KEY, null),
  set: (line) => sessionStorage.setItem(BUY_NOW_KEY, JSON.stringify(line)),
  clear: () => sessionStorage.removeItem(BUY_NOW_KEY)
};

export const lastOrder = {
  get: () => read(sessionStorage, ORDER_KEY, null),
  set: (order) => sessionStorage.setItem(ORDER_KEY, JSON.stringify(order))
};
