// 음성 출력: 크롬 확장 TTS(chrome.tts)로 읽는다. 서비스 워커와 확장 페이지에서 쓸 수 있다.
// 스크린리더는 새 내용을 읽기 시작하면 이전 음성을 끊고(기본), 계속 읽기에서는 대기열에 넣는다.

// 끝까지 읽었거나, 끊겼거나, 실패한 이벤트. 이 중 하나가 오면 그 문장의 읽기가 끝난 것이다.
export const FINAL_EVENTS = ['end', 'interrupted', 'cancelled', 'error'];

// 운영체제 기본 한국어 음성. macOS에는 Eddy, Grandma 같은 재미용 음성도 있어 이 음성들을 먼저 고른다.
const STANDARD_VOICES = ['Heami', 'Yuna', '유나', 'SunHi', 'InJoon'];

// 한국어 음성 고르기: 사용자가 고른 음성 → 기기에 설치된 기본 음성 → 그 밖의 기기 음성.
// Windows는 보통 "Microsoft Heami", macOS는 "Yuna(유나)"가 기본 한국어 음성이다.
// 인터넷 음성(remote)은 읽는 글(편집창 값 포함)이 외부 서버로 가므로 자동으로는 고르지 않고,
// 사용자가 설정에서 직접 고른 경우에만 쓴다. 기기 음성이 없으면 null(브라우저 기본 음성).
export function pickKoreanVoice(voices, preferredName = '') {
  const korean = voices.filter((v) => (v.lang ?? '').toLowerCase().startsWith('ko'));
  const local = korean.filter((v) => !v.remote);
  const standard = local.find((v) => STANDARD_VOICES.some((name) => v.voiceName?.includes(name)));
  return (preferredName && korean.find((v) => v.voiceName === preferredName)) || standard || local[0] || null;
}

export function listVoices() {
  return chrome.tts.getVoices();
}

// 한 문장을 읽고, 끝나거나 끊길 때까지 받은 이벤트와 시간을 돌려준다.
// rate: 1이 보통 속도(0.1~10). enqueue: true면 앞 문장이 끝난 뒤 읽고, false면 앞 문장을 끊는다.
// 끝 이벤트를 보내지 않는 음성도 있어, 글 길이로 넉넉히 잡은 시간이 지나면 끝난 것으로 본다.
export function speechTimeout(text, rate = 1) {
  return 5000 + (text.length * 400) / Math.max(rate, 0.1);
}

export function speak(text, { voiceName, lang = 'ko-KR', rate = 1, enqueue = false } = {}) {
  const started = performance.now();
  const events = [];
  return new Promise((resolve) => {
    let timer = null;
    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const options = {
      lang,
      rate,
      enqueue,
      onEvent(event) {
        events.push({ type: event.type, ms: Math.round(performance.now() - started), charIndex: event.charIndex });
        if (event.type === 'start') {
          clearTimeout(timer);
          timer = setTimeout(() => finish({ events, final: 'timeout' }), speechTimeout(text, rate));
        }
        if (FINAL_EVENTS.includes(event.type)) finish({ events, final: event.type, error: event.errorMessage });
      }
    };
    // 대기열에서 기다리는 시간까지 포함해 시작 신호조차 오지 않는 경우도 대비한다
    timer = setTimeout(() => finish({ events, final: 'timeout' }), speechTimeout(text, rate) * 3);
    if (voiceName) options.voiceName = voiceName;
    try {
      const queued = chrome.tts.speak(text, options);
      // speak 자체가 거부되면(잘못된 음성 이름 등) 이벤트 없이 실패한다.
      queued?.catch?.((error) => finish({ events, final: 'error', error: error.message }));
    } catch (error) {
      finish({ events, final: 'error', error: error.message });
    }
  });
}

export function stop() {
  chrome.tts.stop();
}

// 이벤트 목록에서 처음 소리가 나기 시작한 시간과 끝난 시간을 꺼낸다.
export function timing(result) {
  const start = result.events.find((e) => e.type === 'start')?.ms ?? null;
  const end = result.events.find((e) => FINAL_EVENTS.includes(e.type))?.ms ?? null;
  return { start, end, duration: start !== null && end !== null ? end - start : null };
}
