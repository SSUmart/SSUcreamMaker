// 가상 쇼핑몰(온글몰) 주문 흐름 점검: 실제 Chromium으로 메인 → 상품 → 장바구니 → 주문서 → 가상 결제 → 주문 완료까지 누른다.
// 온글 없이 쇼핑몰 자체가 끝까지 동작하는지 본다 (온글로 쓰는 시험은 사람이 한다).
// 사용법: eval 폴더에서 npm run e2e:mall   (--headed: 창 띄우기)
import { chromium } from 'playwright';
import http from 'node:http';
import { serveShop } from '../shop/serve.mjs';

const server = http.createServer((req, res) => {
  if (!serveShop(req, res)) {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/mall`;

const browser = await chromium.launch({ channel: 'chromium', headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ locale: 'ko-KR' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` | ${String(detail).slice(0, 200)}` : ''}`);
};
const text = (selector) => page.locator(selector).first().innerText().catch(() => '');

console.log('== 1. 장바구니를 거쳐 신용카드로 주문 (기본 배송지)');
await page.goto(`${base}/`);
check('메인: 상품 6개', (await page.locator('.products > li').count()) === 6);
check('메인: 가상 쇼핑몰 안내', (await text('.notice-bar')).includes('실제로 주문·결제되지 않습니다'));
await page.getByRole('link', { name: '주방' }).click();
check('분류: 주방 상품 2개', (await page.locator('.products > li').count()) === 2 && (await text('h1')) === '주방 상품');
await page.getByRole('searchbox', { name: '상품 검색' }).fill('이어폰');
await page.getByRole('button', { name: '검색' }).click();
check('검색: 이어폰 1개', (await page.locator('.products > li').count()) === 1);

await page.goto(`${base}/`);
await page.getByRole('link', { name: /스텐 진공 텀블러/ }).click();
check('상품: 제목', (await text('h1')) === '스텐 진공 텀블러 500ml');
await page.getByRole('button', { name: '장바구니 담기' }).click();
check('옵션 안 고르고 담기: 오류 안내', (await text('#option-error')).includes('색상을(를) 골라 주세요'));
check('품절 옵션은 고를 수 없음', await page.locator('#opt-0 option', { hasText: '민트' }).isDisabled());
await page.getByLabel('색상').selectOption('화이트');
await page.locator('.qty-plus').click();
await page.locator('.qty-plus').click();
check('수량 3개, 총 금액', (await text('.line-total')).includes('74,700원') && (await text('.line-total')).includes('수량 3개'));
await page.getByRole('button', { name: '장바구니 담기' }).click();
check('담기 알림', (await text('.toast')).includes('장바구니에 담았습니다'));
check('머리글 장바구니 개수 3', (await text('.cart-link .badge')) === '3');
await page.getByRole('tab', { name: /리뷰/ }).click();
check('리뷰 탭', await page.locator('#panel-1').isVisible());
await page.getByRole('tab', { name: /리뷰/ }).press('ArrowRight');
check('탭 화살표 이동: 배송 탭', await page.locator('#panel-2').isVisible());

await page.goto(`${base}/product.html?id=mug`);
await page.getByLabel('색상').selectOption('네이비');
await page.getByRole('button', { name: '장바구니 담기' }).click();
await page.goto(`${base}/cart.html`);
check('장바구니: 2줄', (await page.locator('.cart-item').count()) === 2);
check('장바구니: 무료 배송, 합계 87,600원', (await text('.summary')).includes('87,600원') && !(await text('.summary')).includes('더 담으면'));
await page.getByRole('checkbox', { name: '도자기 머그컵 350ml 선택' }).uncheck();
check('머그컵 빼고 선택: 74,700원', (await text('#order')).includes('74,700원'));
check('수량 변경 뒤에도 초점 유지', await (async () => {
  await page.locator('[data-f^="plus-mug"]').focus();
  await page.keyboard.press('Enter');
  return page.evaluate(() => document.activeElement?.dataset?.f?.startsWith('plus-mug'));
})());
await page.getByRole('button', { name: /선택 상품 주문하기/ }).click();

check('주문서: 주문 상품 1건', (await text('#items-title')) === '주문 상품 1건');
await page.getByRole('button', { name: /결제하기/ }).click();
const errorText = await text('#errors');
check('빈 주문서 결제: 오류 목록', errorText.includes('이름을 입력해') && errorText.includes('카드사를 골라') && errorText.includes('동의해'), errorText);
check('오류 목록으로 초점 이동', await page.evaluate(() => document.activeElement?.id === 'errors'));
await page.locator('#errors a').first().click();
check('오류 링크: 해당 칸으로 초점', await page.evaluate(() => document.activeElement?.id === 'orderer-name'));
await page.getByLabel('이름', { exact: true }).fill('김온글');
await page.locator('#orderer-phone').fill('010-1234-5678');
await page.getByLabel('카드사').selectOption('신한카드');
await page.getByLabel('할부').selectOption('3개월');
await page.getByLabel('배송 요청사항', { exact: true }).selectOption('문 앞에 놓아 주세요');
await page.getByRole('checkbox', { name: /결제 진행에 동의/ }).check();
await page.getByRole('button', { name: /결제하기/ }).click();
check('가상 결제창 열림', (await text('.pg')).includes('74,700원') && (await text('.pg')).includes('신한카드 3개월'));
await page.getByRole('button', { name: '결제 승인' }).click();
await page.waitForURL(/complete\.html/);
check('주문 완료: 제목과 주문번호', (await text('h1')) === '주문이 완료되었습니다' && /주문번호 \d{8}-\d{6}/.test(await text('.order-no')));
const receipt = await text('.receipt');
check('주문 완료: 상품, 배송지, 결제', receipt.includes('스텐 진공 텀블러') && receipt.includes('상도로 369') && receipt.includes('74,700원') && receipt.includes('문 앞에'), receipt);
await page.goto(`${base}/cart.html`);
check('주문한 상품은 장바구니에서 빠지고 머그컵만 남음', (await page.locator('.cart-item').count()) === 1 && (await text('.cart-item')).includes('머그컵'));

console.log('\n== 2. 바로 구매, 새 배송지(우편번호 찾기), 무통장입금');
await page.goto(`${base}/product.html?id=socks`);
check('품절 사이즈 버튼은 누를 수 없음', await page.getByRole('button', { name: '270mm 품절' }).isDisabled());
await page.getByRole('button', { name: '250mm', exact: true }).click();
await page.getByRole('button', { name: '바로 구매' }).click();
check('바로 구매: 양말만 주문', (await text('.order-items')).includes('면 양말') && !(await text('.order-items')).includes('머그컵'));
check('3만 원 미만: 배송비 3,000원', (await text('.summary')).includes('12,900원'));
await page.getByLabel('새로 입력').check();
await page.getByLabel('받는 분', { exact: true }).fill('이받음');
await page.getByLabel('받는 분 휴대폰 번호').fill('010-9876-5432');
await page.getByRole('button', { name: '우편번호 찾기' }).click();
check('우편번호 찾기: 대화상자와 초점', (await page.getByRole('dialog', { name: '우편번호 찾기' }).isVisible()) && (await page.evaluate(() => document.activeElement?.id === 'zip-q')));
await page.getByLabel('주소 검색어').fill('세종대로');
await page.getByLabel('주소 검색어').press('Enter');
check('주소 검색 결과 1개', (await text('#zip-count')) === '검색 결과 1개');
await page.getByRole('button', { name: /세종대로 110/ }).click();
check('주소 채움, 상세 주소로 초점', (await page.getByLabel('우편번호', { exact: true }).inputValue()) === '04524' && (await page.evaluate(() => document.activeElement?.id === 'ship-detail')));
await page.getByLabel('상세 주소').fill('3층');
await page.getByLabel('이름', { exact: true }).fill('이주문');
await page.locator('#orderer-phone').fill('01055556666');
await page.getByLabel('무통장입금').check();
await page.getByLabel('입금 은행').selectOption('국민은행');
await page.getByLabel('입금자 이름').fill('이주문');
await page.getByRole('checkbox', { name: /결제 진행에 동의/ }).check();
await page.getByRole('button', { name: /결제하기/ }).click();
await page.getByRole('button', { name: '결제 승인' }).click();
await page.waitForURL(/complete\.html/);
const receipt2 = await text('.receipt');
check('주문 완료: 새 배송지, 무통장입금, 배송비 포함', receipt2.includes('세종대로 110 3층') && receipt2.includes('국민은행') && receipt2.includes('12,900원'), receipt2);
await page.goto(`${base}/cart.html`);
check('바로 구매는 장바구니를 건드리지 않음', (await page.locator('.cart-item').count()) === 1);

console.log('\n== 3. 간편결제는 서비스를 골라야 함');
await page.goto(`${base}/product.html?id=earphone`);
await page.getByLabel('색상').selectOption('화이트');
await page.getByRole('button', { name: '바로 구매' }).click();
await page.getByLabel('이름', { exact: true }).fill('박간편');
await page.locator('#orderer-phone').fill('010-1111-2222');
await page.getByLabel('간편결제').check();
await page.getByRole('checkbox', { name: /결제 진행에 동의/ }).check();
await page.getByRole('button', { name: /결제하기/ }).click();
check('간편결제 서비스 안 고름: 오류', (await text('#errors')).includes('간편결제 서비스를 골라'));
await page.locator('[data-pay="kakaopay"]').click();
await page.getByRole('button', { name: /결제하기/ }).click();
check('가상 결제창: 카카오페이', (await text('.pg')).includes('카카오페이'));
await page.getByRole('button', { name: '결제 승인' }).click();
await page.waitForURL(/complete\.html/);
check('주문 완료: 49,900원', (await text('.receipt')).includes('49,900원'));

check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
console.log(`\n합계: 통과 ${pass}, 실패 ${fail}`);
if (fail) process.exitCode = 1;
await browser.close();
server.close();
