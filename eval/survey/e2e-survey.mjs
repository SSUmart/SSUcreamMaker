// 설문 서비스 화면 점검: 실제 Chromium으로 관리자 로그인 → 설문 만들기 → 팀원·사용자 링크로 응답 → AI 답 입력 → 끝내기 → 결과 페이지(분석표, 공개).
// 테스트 서버와 같은 모양으로, 쇼핑몰과 한 포트를 쓰는 합친 서버(web.mjs)의 /survey/ 아래에서 점검한다.
// 임시 폴더에 서버를 띄우므로 실제 응답 데이터는 건드리지 않는다.
// 사용법: eval 폴더에서 npm run e2e:survey   (--headed: 창 띄우기, --shots <폴더>: 화면 저장)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWebServer } from '../web.mjs';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-e2e-'));
const server = createWebServer({ survey: { dataDir, password: 'e2e-pass', basePath: '/survey' } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/survey`;

const browser = await chromium.launch({ channel: 'chromium', headless: !args.includes('--headed') });
const page = await browser.newPage({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.accept());

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` | ${String(detail).slice(0, 200)}` : ''}`);
};
const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
if (shots) fs.mkdirSync(shots, { recursive: true });

try {
  console.log('== 한 포트에 함께');
  check('쇼핑몰도 같은 포트에서 열림', (await page.goto(`${origin}/mall/`)).ok());
  check('/survey → 관리자 화면으로', (await page.goto(`${base}`)) && new URL(page.url()).pathname === '/survey/admin');

  console.log('\n== 관리자');
  await page.goto(`${base}/`);
  await page.getByLabel('관리자 비밀번호').fill('틀린 비밀번호');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByText('비밀번호가 맞지 않습니다').waitFor();
  check('틀린 비밀번호 안내', true);
  await page.getByLabel('관리자 비밀번호').fill('e2e-pass');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('heading', { name: '설문 목록', level: 1 }).waitFor();
  check('로그인 → 설문 목록, 제목에 초점', (await focusedText()) === '설문 목록');

  await page.getByRole('button', { name: '설문 만들기' }).click();
  check('빈 설문 만들기: 오류', (await page.locator('.error-box').first().innerText()).includes('설문 제목을 입력'));
  await page.getByLabel('설문 제목').fill('온글 1차 평가');
  await page.getByLabel('안내 문구').fill('온글을 써 본 경험을 알려 주세요.');
  await page.getByLabel('문항 (한 줄에 한 문항)').fill('# 시작하기\n1. 첫 안내에 얼마나 만족하셨나요?\n2. 키 도움말에 얼마나 만족하셨나요?\n# AI 기능\n3. 상세 이미지 읽기에 얼마나 만족하셨나요?');
  await page.getByRole('button', { name: '설문 만들기' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  check('설문 상세로 이동', /#\/s\//.test(page.url()));
  const teamLink = await page.getByLabel('팀원용 링크').inputValue();
  const userLink = await page.getByLabel('사용자용 링크').inputValue();
  check('팀원·사용자 링크가 따로 있고 /survey/s/ 아래', teamLink !== userLink && teamLink.startsWith(`${base}/s/`) && userLink.startsWith(`${base}/s/`));
  check('끝내기 전에는 분석표 대신 안내', (await page.locator('main').innerText()).includes('설문을 끝내면'));
  await shot('admin-detail');

  // 응답 전 수정: 문항까지 고칠 수 있음
  await page.getByRole('link', { name: '수정', exact: true }).click();
  await page.getByRole('heading', { name: '설문 수정', level: 1 }).waitFor();
  check('수정 화면, 제목에 초점, 문항 고칠 수 있음', (await focusedText()) === '설문 수정' && !(await page.getByLabel('문항 (한 줄에 한 문항)').getAttribute('readonly') !== null));
  await page.getByLabel('안내 문구 (선택, 응답 화면 맨 위에 나옴)').fill('온글을 써 본 경험을 알려 주세요. (고침)');
  await page.getByRole('button', { name: '저장' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  check('수정 저장 → 설문 화면으로', /#\/s\/[^/]+$/.test(page.url()));

  console.log('\n== 응답자');
  const answer = async (link, scores, comment) => {
    await page.goto(link);
    await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
    for (const [i, score] of scores.entries()) {
      const group = page.getByRole('group', { name: new RegExp(`^${i + 1}\\. `) });
      await group.getByRole('radio', { name: new RegExp(`^${score}점`) }).check();
    }
    if (comment) await page.getByLabel('하고 싶은 말 (선택)').fill(comment);
    await page.getByRole('button', { name: '응답 보내기' }).click();
    await page.getByRole('heading', { name: '응답해 주셔서 감사합니다' }).waitFor();
  };

  await page.goto(teamLink);
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  check('고친 안내 문구가 응답 화면에 나옴', (await page.locator('main').innerText()).includes('(고침)'));
  check('응답 화면: 팀원 표시, 문항 묶음 3개', (await page.getByText('팀원 평가', { exact: true }).count()) === 1 && (await page.getByRole('group').count()) === 3);
  check('점수 버튼에 뜻이 붙어 있음, 해당 없음 선택지는 없음', (await page.getByRole('radio', { name: '1점 매우 불만족' }).count()) === 3 && (await page.getByRole('radio', { name: '해당 없음' }).count()) === 0 && (await page.getByRole('radio').count()) === 15);
  await page.getByRole('group', { name: /^1\. / }).getByRole('radio', { name: '4점 만족' }).check();
  await page.getByRole('button', { name: '응답 보내기' }).click();
  const err = await page.locator('#errors').innerText();
  check('빠진 문항 오류 목록과 초점', err.includes('답하지 않은 문항이 2개') && (await page.evaluate(() => document.activeElement?.id)) === 'errors', err);
  const described = await page.getByRole('group', { name: /^2\. / }).getByRole('radio', { name: '3점 보통' }).evaluate((el) => document.getElementById(el.getAttribute('aria-describedby'))?.textContent);
  check('빠진 문항의 점수 버튼에 "답하지 않은 문항" 안내 연결', described === '답하지 않은 문항입니다.', described);
  await page.locator('#errors a').first().click();
  check('오류 링크 → 그 문항의 첫 점수로 초점', (await page.evaluate(() => document.activeElement?.id)) === 'first-q2');
  await shot('respond-error');
  await page.getByRole('group', { name: /^2\. / }).getByRole('radio', { name: '4점 만족' }).check();
  await page.getByRole('group', { name: /^3\. / }).getByRole('radio', { name: '5점 매우 만족' }).check();
  await page.getByRole('button', { name: '응답 보내기' }).click();
  await page.getByRole('heading', { name: '응답해 주셔서 감사합니다' }).waitFor();
  check('팀원 응답 완료, 제목에 초점', (await focusedText()) === '응답해 주셔서 감사합니다');
  await page.getByRole('button', { name: '다른 사람이 새로 응답하기' }).click();
  check('같은 PC에서 새 응답 시작 (빈 양식)', (await page.locator('input[type=radio]:checked').count()) === 0);

  await answer(userLink, [5, 4, 2], '상세 이미지 읽기가 조금 느려요');
  await answer(userLink, [4, 3, 3]);
  check('사용자 응답 2개 완료', true);

  console.log('\n== AI 답, 끝내기, 분석표');
  await page.goto(`${base}/admin#/`);
  await page.getByRole('link', { name: '온글 1차 평가', exact: true }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  check('응답 현황: 팀원 1, 사용자 2', (await page.locator('main').innerText()).includes('팀원 응답 1개') && (await page.locator('main').innerText()).includes('사용자 응답 2개'));
  await page.getByText('AI에 보낼 질문 글 보기').click();
  check('AI 질문 글에 문항 포함', (await page.getByLabel('AI에 보낼 질문 글').inputValue()).includes('3. 상세 이미지 읽기'));
  await page.getByLabel('AI 이름').fill('Claude');
  await page.getByLabel('AI 답', { exact: true }).fill('| 번호 | 점수 | 이유 |\n|---|---|---|\n| 1 | 5 | 첫 안내가 자세하다 |\n| 3 | 5 | 상세 이미지를 읽는다 |');
  await page.getByRole('button', { name: 'AI 답 저장' }).click();
  await page.getByText('2번 문항의 답을 찾지 못했습니다').waitFor();
  check('빠진 AI 답 안내', true);
  check('오류 상자에 빈 값 글자(null) 없음', !/\bnull\b/.test(await page.locator('.error-box').filter({ hasText: '찾지 못했습니다' }).innerText()));
  await page.getByRole('button', { name: '빠진 문항은 해당 없음으로 저장' }).click();
  await page.getByText('AI 답 1개').waitFor();
  check('AI 답 저장', (await page.getByRole('button', { name: 'Claude 답 지우기' }).count()) === 1);

  check('끝내기 전: 결과 페이지 주소를 미리 알려 줌, 분석표 열기 대신 결과 미리보기', (await page.getByLabel('결과 페이지 주소').inputValue()) === `${base}/result-1` && (await page.getByRole('link', { name: '분석표 열기' }).count()) === 0);
  await page.getByRole('link', { name: '결과 미리보기' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가 결과 미리보기', level: 1 }).waitFor();
  const previewText = await page.locator('main').innerText();
  check('미리보기: 진행 중 안내와 지금까지의 분석표(사용자 응답 2개), 빈 값 글자(null) 없음', !/\bnull\b/.test(previewText) && previewText.includes('아직 진행 중인 설문입니다') && previewText.includes('사용자 응답 2개') && (await page.getByRole('row', { name: /^3\. 상세 이미지/ }).count()) === 1, previewText.slice(0, 200));
  await shot('result-preview');
  const guestEarly = await browser.newPage({ locale: 'ko-KR' });
  await guestEarly.goto(`${base}/result-1`);
  await guestEarly.getByRole('heading', { name: '결과를 볼 수 없습니다', level: 1 }).waitFor();
  check('미리보기는 관리자만: 로그인하지 않은 사람은 볼 수 없음', true);
  await guestEarly.close();
  await page.getByRole('link', { name: '설문 관리로 돌아가기' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  await page.getByRole('button', { name: '설문 끝내기' }).click();
  await page.getByRole('link', { name: '분석표 열기' }).waitFor();
  check('끝낸 뒤: 분석표 열기 버튼', true);
  const csvHref = await page.getByRole('link', { name: '응답 내려받기 (CSV)' }).getAttribute('href');
  const csv = await page.evaluate((href) => fetch(href).then((r) => r.status), csvHref);
  check('CSV 링크도 /survey 아래에서 받아짐', csvHref.startsWith('/survey/api/') && csv === 200, `${csvHref} ${csv}`);
  check('끝난 설문은 링크 안내 없음', !(await page.getByLabel('사용자용 링크').count()));

  await page.getByRole('link', { name: '분석표 열기' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가 결과', level: 1 }).waitFor();
  check('분석표는 별도 페이지 /survey/result-1, 제목에 초점', new URL(page.url()).pathname === '/survey/result-1' && (await focusedText()) === '온글 1차 평가 결과', page.url());
  const report = await page.locator('main').innerText();
  check('분석표: AI·팀원·사용자 세 점수', report.includes('AI 평가') && report.includes('팀원 평가') && report.includes('사용자 평가'));
  const q3 = await page.getByRole('row', { name: /^3\. 상세 이미지/ }).innerText();
  check('3번 문항: AI 5.00, 팀원 5.00, 사용자 2.50, 차이 -2.50', q3.includes('5.00') && q3.includes('2.50') && q3.includes('-2.50'), q3);
  check('영역별 비교 표', (await page.getByRole('table', { name: /영역별/ }).count()) === 1);
  check('눈여겨볼 문항에 3번', report.includes('3번 상세 이미지 읽기'));
  check('하고 싶은 말', report.includes('상세 이미지 읽기가 조금 느려요'));
  check('관리자에게: 아직 공개 전 안내, 설문 관리로 돌아가는 링크', report.includes('관리자만 볼 수 있습니다') && (await page.getByRole('link', { name: '설문 관리로 돌아가기' }).count()) === 1);
  await shot('result-page');

  // 로그인하지 않은 사람: 공개 전에는 볼 수 없음
  const guest = await browser.newPage({ locale: 'ko-KR' });
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`${base}/result-1`);
  await guest.getByRole('heading', { name: '결과를 볼 수 없습니다', level: 1 }).waitFor();
  check('공개 전: 로그인하지 않은 사람은 결과를 볼 수 없음', !(await guest.locator('main').innerText()).includes('상세 이미지'));

  // 결과 공개 켜기 → 로그인 없이 보임
  await page.getByRole('link', { name: '설문 관리로 돌아가기' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  await page.getByLabel('결과 공개 (로그인 없이 주소로 보기)').check();
  await page.waitForFunction(() => document.getElementById('live').textContent.includes('공개했습니다'));
  await guest.reload();
  await guest.getByRole('heading', { name: '온글 1차 평가 결과', level: 1 }).waitFor();
  const guestText = await guest.locator('main').innerText();
  check('공개 후: 로그인 없이 결과 페이지에서 분석표를 봄 (관리 링크·안내·null 글자 없음)', !/\bnull\b/.test(guestText) && guestText.includes('사용자 평가') && guestText.includes('상세 이미지 읽기가 조금 느려요') && !guestText.includes('설문 관리로') && !guestText.includes('관리자만'));
  await page.reload();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  check('공개 설정이 저장됨', await page.getByLabel('결과 공개 (로그인 없이 주소로 보기)').isChecked());
  await page.getByLabel('결과 공개 (로그인 없이 주소로 보기)').uncheck();
  await page.waitForFunction(() => document.getElementById('live').textContent.includes('공개를 껐습니다'));
  await guest.reload();
  await guest.getByRole('heading', { name: '결과를 볼 수 없습니다', level: 1 }).waitFor();
  check('공개를 끄면 다시 볼 수 없음', true);
  await guest.close();

  await page.goto(`${base}/admin#/`);
  await page.getByRole('heading', { name: '설문 목록', level: 1 }).waitFor();
  check('설문 목록: 끝낸 설문에 결과 페이지 링크', (await page.getByRole('link', { name: '온글 1차 평가 분석표' }).getAttribute('href')) === '/survey/result-1');
  await shot('admin-analysis');

  await page.goto(userLink);
  await page.getByText('종료된 설문입니다').waitFor();
  check('끝난 설문 링크: 종료 안내', true);

  console.log('\n== 수정 제한, 복제, 삭제');
  await page.goto(`${base}/admin#/`);
  await page.getByRole('link', { name: '온글 1차 평가', exact: true }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  await page.getByRole('link', { name: '수정', exact: true }).click();
  await page.getByRole('heading', { name: '설문 수정', level: 1 }).waitFor();
  check('응답 받은 설문: 문항은 읽기만, 이유 안내', (await page.getByLabel('문항 (한 줄에 한 문항)').getAttribute('readonly')) !== null && (await page.locator('#questions-hint').innerText()).includes('복제'));
  await page.getByRole('link', { name: '취소' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가', level: 1 }).waitFor();
  await page.getByRole('button', { name: '복제' }).click();
  await page.getByRole('heading', { name: '온글 1차 평가 (복사본)', level: 1 }).waitFor();
  const copyMain = await page.locator('main').innerText();
  check('복제: 새 설문, 응답 없음, 진행 중', copyMain.includes('사용자 응답 0개') && copyMain.includes('진행 중') && (await page.getByLabel('사용자용 링크').inputValue()) !== userLink);
  await page.getByRole('button', { name: '삭제' }).click(); // 확인 대화상자는 위에서 자동 수락
  await page.getByRole('heading', { name: '설문 목록', level: 1 }).waitFor();
  check('삭제 → 목록에서 사라짐', (await page.getByRole('link', { name: '온글 1차 평가 (복사본)' }).count()) === 0 && (await page.getByRole('link', { name: '온글 1차 평가', exact: true }).count()) === 1);
  check('삭제한 설문은 휴지통 파일로 남음', fs.readdirSync(path.join(dataDir, 'trash')).length === 1);

  await page.goto(`${base}/admin#/`);
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.getByLabel('관리자 비밀번호').waitFor();
  check('로그아웃', true);
} catch (e) {
  check('흐름 중 오류', false, e.message);
} finally {
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
  console.log(`\n합계: 통과 ${pass}, 실패 ${fail}`);
  if (fail) process.exitCode = 1;
  await browser.close();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
