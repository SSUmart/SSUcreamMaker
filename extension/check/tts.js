// 음성(TTS) 확인 페이지: 스크린리더 음성 출력에 필요한 chrome.tts 기능을 차례로 확인한다.
import { listVoices, pickKoreanVoice, speak, stop, timing } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const SHORT = '안녕하세요. 온글 음성 확인입니다.';
const LONG =
  '이 문장은 중간에 끊기는지 확인하기 위한 긴 문장입니다. 스크린리더는 사용자가 다음 항목으로 이동하면 읽던 내용을 바로 멈추고 새 내용을 읽어야 합니다.';
const RATE_TEXT = '장바구니 담기, 버튼. 바로 구매, 버튼. 찜하기, 전환 버튼, 눌리지 않음.';

const results = [];
let voices = [];

function voiceName() {
  return $('voice').value || undefined;
}

function record(name, outcome, detail) {
  results.push({ name, outcome, detail });
  const row = document.createElement('tr');
  const cls = { 통과: 'pass', 실패: 'fail', 참고: 'info' }[outcome];
  row.innerHTML = '<th scope="row"></th><td></td><td></td>';
  row.cells[0].textContent = name;
  row.cells[1].textContent = outcome;
  row.cells[1].className = cls;
  row.cells[2].textContent = detail;
  $('results').append(row);
  renderReport();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const eventList = (result) => result.events.map((e) => `${e.type}@${e.ms}ms`).join(', ') || '이벤트 없음';

// 서비스 워커에서 읽기 (스크린리더 본체는 서비스 워커에서 음성을 낸다)
function speakInWorker(text, options) {
  return chrome.runtime.sendMessage({ type: 'speech-check', text, options });
}

async function loadVoices() {
  voices = await listVoices();
  const korean = voices.filter((v) => (v.lang ?? '').toLowerCase().startsWith('ko'));
  const select = $('voice');
  select.replaceChildren();
  for (const v of korean) {
    const option = new Option(`${v.voiceName} (${v.lang}${v.remote ? ', 인터넷 음성' : ', 기기 음성'})`, v.voiceName);
    select.append(option);
  }
  const picked = pickKoreanVoice(voices);
  if (picked) select.value = picked.voiceName;
  $('voice-note').textContent = korean.length
    ? `한국어 음성 ${korean.length}개, 전체 음성 ${voices.length}개를 찾았습니다.`
    : `한국어 음성이 없습니다(전체 음성 ${voices.length}개). Windows는 설정 → 시간 및 언어 → 음성에서 한국어 음성을 추가하세요.`;
}

async function runAll() {
  results.length = 0;
  $('results').replaceChildren();
  $('run').disabled = true;
  const status = (text) => ($('status').textContent = text);
  try {
    // 1. 음성 목록
    await loadVoices();
    const korean = voices.filter((v) => (v.lang ?? '').toLowerCase().startsWith('ko'));
    record(
      '1. 한국어 음성 있음',
      korean.length ? '통과' : '실패',
      korean.map((v) => `${v.voiceName}${v.remote ? '(인터넷)' : '(기기)'}`).join(', ') || '없음'
    );
    const name = voiceName();

    // 2. 확장 페이지에서 한국어 읽기
    status('2/8 짧은 문장을 읽는 중');
    const basic = await speak(SHORT, { voiceName: name });
    const t = timing(basic);
    record(
      '2. 한국어 문장 읽기 (확장 페이지)',
      basic.final === 'end' ? '통과' : '실패',
      `시작까지 ${t.start ?? '-'}ms, 읽은 시간 ${t.duration ?? '-'}ms. ${basic.error ?? ''} 이벤트: ${eventList(basic)}`
    );

    // 3. 서비스 워커에서 읽기
    status('3/8 서비스 워커에서 읽는 중');
    const worker = await speakInWorker(SHORT, { voiceName: name });
    record(
      '3. 서비스 워커에서 읽기',
      worker?.final === 'end' ? '통과' : '실패',
      worker ? `시작까지 ${timing(worker).start ?? '-'}ms. ${worker.error ?? ''} 이벤트: ${eventList(worker)}` : '응답 없음'
    );

    // 4. 즉시 중단
    status('4/8 읽다가 멈추는 중');
    const longRun = speak(LONG, { voiceName: name });
    await wait(1200);
    const stopAt = performance.now();
    stop();
    const stopped = await Promise.race([longRun, wait(3000).then(() => null)]);
    const stopMs = Math.round(performance.now() - stopAt);
    record(
      '4. 읽기 즉시 중단',
      stopped && ['interrupted', 'cancelled'].includes(stopped.final) ? '통과' : '실패',
      stopped ? `중지 후 ${stopMs}ms 만에 ${stopped.final}. 이벤트: ${eventList(stopped)}` : '3초 안에 멈추지 않음'
    );

    // 5. 새 내용이 이전 내용을 끊기 (다음 항목으로 이동할 때)
    status('5/8 새 문장으로 끊는 중');
    const first = speak(LONG, { voiceName: name });
    await wait(1200);
    const second = speak(SHORT, { voiceName: name, enqueue: false });
    const [r1, r2] = await Promise.all([first, second]);
    record(
      '5. 새 문장이 이전 문장을 끊음',
      ['interrupted', 'cancelled'].includes(r1.final) && r2.final === 'end' ? '통과' : '실패',
      `앞 문장: ${r1.final}, 새 문장: ${r2.final}`
    );

    // 6. 대기열 (계속 읽기)
    status('6/8 두 문장을 이어서 읽는 중');
    const q1 = speak('첫 번째 문장입니다.', { voiceName: name, enqueue: false });
    const q2 = speak('두 번째 문장입니다.', { voiceName: name, enqueue: true });
    const [a, b] = await Promise.all([q1, q2]);
    record(
      '6. 이어 읽기(대기열)',
      a.final === 'end' && b.final === 'end' ? '통과' : '실패',
      `첫 문장: ${a.final}, 둘째 문장: ${b.final}`
    );

    // 7. 속도 조절
    status('7/8 보통 속도와 빠른 속도로 읽는 중');
    const normal = timing(await speak(RATE_TEXT, { voiceName: name, rate: 1 })).duration;
    const fast = timing(await speak(RATE_TEXT, { voiceName: name, rate: 2 })).duration;
    const ratio = normal && fast ? fast / normal : null;
    record(
      '7. 속도 조절',
      ratio !== null && ratio < 0.8 ? '통과' : '실패',
      `보통 ${normal ?? '-'}ms, 2배속 ${fast ?? '-'}ms${ratio ? ` (비율 ${ratio.toFixed(2)})` : ''}`
    );

    // 8. 읽는 위치 이벤트 (없어도 스크린리더는 동작함, 참고용)
    status('8/8 읽는 위치 이벤트 확인 중');
    const words = await speak(SHORT, { voiceName: name });
    const wordCount = words.events.filter((e) => e.type === 'word').length;
    const voice = voices.find((v) => v.voiceName === name);
    record(
      '8. 읽는 위치(word) 이벤트',
      '참고',
      `${wordCount}개 받음. 음성이 알리는 지원 이벤트: ${(voice?.eventTypes ?? []).join(', ') || '정보 없음'}`
    );
    status('확인이 끝났습니다. 결과 표를 확인하세요.');
  } catch (error) {
    record('오류', '실패', error.message);
    status(`오류로 중단했습니다. ${error.message}`);
  } finally {
    $('run').disabled = false;
  }
}

function renderReport() {
  const heard = document.querySelector('input[name="heard"]:checked')?.value ?? '미응답';
  $('report').textContent = [
    '온글 음성(TTS) 확인 결과',
    `시각: ${new Date().toLocaleString('ko-KR')}`,
    `브라우저: ${navigator.userAgent}`,
    `선택한 음성: ${voiceName() ?? '없음'}`,
    `귀로 확인: ${heard}`,
    ...results.map((r) => `- ${r.name}: ${r.outcome} | ${r.detail}`)
  ].join('\n');
}

$('run').addEventListener('click', runAll);
$('stop').addEventListener('click', stop);
$('copy').addEventListener('click', async () => {
  renderReport();
  await navigator.clipboard.writeText($('report').textContent);
  $('status').textContent = '결과를 복사했습니다.';
});
document.querySelectorAll('input[name="heard"]').forEach((input) => input.addEventListener('change', renderReport));
$('voice').addEventListener('change', renderReport);

loadVoices().then(renderReport);
