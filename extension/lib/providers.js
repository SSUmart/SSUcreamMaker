import { STRUCTURE_PROMPT, TRANSCRIBE_PROMPT } from './structure.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TILE_ORDER_NOTE =
  '이미지 조각은 위에서 아래 순서이며 경계가 조금씩 겹칩니다. 겹쳐서 반복된 글자는 한 번만 쓰세요.';

// 오류 안내는 사용자가 듣는 문장이므로 서버 응답 원문(영어, 주소·쿼리가 들어 있을 수 있음)은 읽지 않고 상태별 한국어로 알린다.
// 원문은 개발자가 볼 수 있게 서비스 워커 콘솔에만 남긴다.
async function apiError(name, res) {
  const body = await res.text().catch(() => '');
  console.warn(`${name} 오류 응답 (${res.status})`, body.slice(0, 500));
  if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(body)) {
    return new Error(`${name} API 키가 올바르지 않습니다. 온글 설정에서 API 키를 확인하세요.`);
  }
  if (res.status === 429) {
    return new Error(`${name} 요청 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 온글 설정에서 다른 모델을 고르세요.`);
  }
  if (res.status === 503) {
    return new Error(`${name} 서버가 붐빕니다. 잠시 뒤 다시 시도하거나 온글 설정에서 다른 모델을 고르세요.`);
  }
  // 조사: Gemini(제미나이)는 '가', NVIDIA NIM(엔아이엠)은 받침이 있어 '이'
  const subject = `${name}${/NIM$/.test(name) ? '이' : '가'}`;
  if (res.status === 400) return new Error(`${subject} 요청을 받지 않았습니다 (오류 400). 온글 설정에서 모델 이름을 확인하세요.`);
  if (res.status === 404) return new Error(`${name}에서 모델이나 API 주소를 찾지 못했습니다 (오류 404). 온글 설정에서 모델과 API 주소를 확인하세요.`);
  if (res.status >= 500) return new Error(`${name} 서버에 문제가 생겼습니다 (오류 ${res.status}). 잠시 뒤 다시 시도하세요.`);
  return new Error(`${name} 요청이 실패했습니다 (오류 ${res.status}). 잠시 뒤 다시 시도하세요.`);
}

// 응답 본문을 JSON으로 읽는다. 형식이 깨졌으면 영어 해석 오류 대신 한국어로 알린다
async function readJson(name, res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`${name} 응답이 JSON이 아님`, text.slice(0, 500));
    throw new Error(`${name} 응답을 읽지 못했습니다. 응답 형식이 올바르지 않습니다. 잠시 뒤 다시 시도하세요.`);
  }
}

// Gemini가 답을 비워 보낸 이유 (finishReason)를 사용자가 알아들을 말로
const FINISH_REASONS = {
  SAFETY: '안전 기준에 걸려 답을 만들지 않았습니다',
  RECITATION: '저작권 보호 기준에 걸려 답을 만들지 않았습니다',
  MAX_TOKENS: '답이 너무 길어 끝까지 만들지 못했습니다',
  BLOCKLIST: '금지어 기준에 걸려 답을 만들지 않았습니다',
  PROHIBITED_CONTENT: '금지된 내용 기준에 걸려 답을 만들지 않았습니다'
};

// 일시적인 오류(503 서버 과부하, 429 요청 한도)는 잠깐 기다렸다가 다시 보낸다. 키·주소·요청 오류(400·401·403·404)는 바로 알린다.
// 기다리는 시간은 테스트에서 줄일 수 있게 밖으로 둔다.
export const RETRY = { statuses: [429, 503], delays: [2000, 5000] };

async function fetchWithRetry(name, url, init) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (error) {
      console.warn(`${name} 연결 실패`, error);
      throw new Error(`${name} 서버에 연결하지 못했습니다. 인터넷 연결과 온글 설정의 API 주소를 확인하세요.`);
    }
    if (res.ok || !RETRY.statuses.includes(res.status) || attempt >= RETRY.delays.length) return res;
    await new Promise((resolve) => setTimeout(resolve, RETRY.delays[attempt]));
  }
}

// --- Gemini: 조각 전체를 한 번에 보내 바로 JSON으로 정리한다.
async function geminiGenerate(config, parts, json) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(config.model)}:generateContent`;
  const res = await fetchWithRetry('Gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      ...(json && { generationConfig: { responseMimeType: 'application/json' } })
    })
  });
  if (!res.ok) throw await apiError('Gemini', res);
  const body = await readJson('Gemini', res);
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    const reason = FINISH_REASONS[body.candidates?.[0]?.finishReason ?? body.promptFeedback?.blockReason];
    throw new Error(`Gemini 응답이 비어 있습니다.${reason ? ` ${reason}.` : ''} 잠시 뒤 다시 시도하세요.`);
  }
  return text;
}

const gemini = {
  label: 'Gemini',
  maxBase64Length: Infinity,
  async extract(tiles, config) {
    const parts = [
      { text: `${STRUCTURE_PROMPT}\n${TILE_ORDER_NOTE}` },
      ...tiles.map((t) => ({ inlineData: { mimeType: t.mimeType, data: t.data } }))
    ];
    return geminiGenerate(config, parts, true);
  },
  // 이미지 없이 글만 보내 JSON 답을 받는다 (요약, 질문 응답).
  async generateJson(prompt, config) {
    return geminiGenerate(config, [{ text: prompt }], true);
  },
  // 항목 설명: 글과 (있으면) 그림 조각을 함께 보내 JSON 답을 받는다.
  async describe(prompt, tiles, config) {
    const images = tiles.map((t) => ({ inlineData: { mimeType: t.mimeType, data: t.data } }));
    return geminiGenerate(config, [{ text: prompt }, ...images], true);
  },
  async test(config) {
    await geminiGenerate(config, [{ text: 'OK라고만 답하세요.' }], false);
  }
};

// --- NVIDIA NIM: 다중 이미지 지원이 모델마다 달라 조각별로 글자를 읽은 뒤 텍스트로 정리한다.
async function nimChat(config, content, maxTokens) {
  const res = await fetchWithRetry('NVIDIA NIM', `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content }],
      max_tokens: maxTokens,
      temperature: 0,
      stream: false
    })
  });
  if (!res.ok) throw await apiError('NVIDIA NIM', res);
  const body = await readJson('NVIDIA NIM', res);
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('NVIDIA NIM 응답이 비어 있습니다.');
  // 추론형 모델이 붙이는 생각 과정은 버린다.
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// 한 번에 읽는 조각 수. 기다리는 시간을 줄이되, 무료 키의 분당 요청 한도(약 40회)를 넘지 않게 작게 둔다.
const NIM_CONCURRENCY = 3;

// 조각마다 글자를 읽는다(동시에 몇 개씩, 결과는 원래 순서대로). 글자가 없는 조각은 뺀다.
// 한 조각이라도 실패하면 나머지 작업자도 새 조각을 받지 않는다 (실패 뒤에 요청이 계속 나가 한도를 쓰고,
// 그 진행 안내가 오류 안내를 덮지 않도록).
async function nimTranscribe(tiles, config, onProgress) {
  const results = new Array(tiles.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < tiles.length && !failed) {
      const i = next++;
      try {
        results[i] = await transcribeTile(tiles[i], i, tiles.length, config, (text) => failed || onProgress(text));
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(NIM_CONCURRENCY, tiles.length) }, worker));
  return results.filter((text) => text !== null);
}

async function transcribeTile(tile, i, total, config, onProgress) {
  onProgress(`상세 이미지 조각 ${i + 1}/${total} 읽는 중`);
  const text = await nimChat(
    config,
    [
      { type: 'image_url', image_url: { url: `data:${tile.mimeType};base64,${tile.data}` } },
      { type: 'text', text: TRANSCRIBE_PROMPT }
    ],
    2048
  );
  return text === '없음' ? null : text;
}

const nim = {
  label: 'NVIDIA NIM',
  // build.nvidia.com 호스팅 API는 인라인 이미지 크기 제한이 있어 조각을 이 크기 아래로 압축한다.
  maxBase64Length: 180_000,
  async extract(tiles, config, onProgress = () => {}) {
    const texts = await nimTranscribe(tiles, config, onProgress);
    if (!texts.length) return '{"sections":[]}';
    onProgress('읽은 내용 정리 중');
    return nimChat(
      config,
      `${STRUCTURE_PROMPT}\n${TILE_ORDER_NOTE}\n\n이미지에서 읽은 글자:\n${texts.join('\n\n')}`,
      4096
    );
  },
  // 이미지 없이 글만 보내 JSON 답을 받는다. NIM은 JSON 모드가 모델마다 달라 프롬프트로만 요구한다.
  async generateJson(prompt, config) {
    // 요약·답변은 짧으므로 답 길이 상한을 낮춰 기다리는 시간을 줄인다
    return nimChat(config, prompt, 1024);
  },
  // 항목 설명: 그림이 있으면 조각별로 글자를 먼저 읽어 글로 붙인다.
  async describe(prompt, tiles, config, onProgress = () => {}) {
    if (!tiles.length) return nimChat(config, prompt, 1024);
    const texts = await nimTranscribe(tiles, config, onProgress);
    return nimChat(config, `${prompt}\n\n그림에서 읽은 글자:\n${texts.join('\n\n') || '(글자 없음)'}`, 1024);
  },
  async test(config) {
    await nimChat(config, 'OK라고만 답하세요.', 16);
  }
};

export const PROVIDERS = { gemini, nim };
