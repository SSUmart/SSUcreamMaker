// NVIDIA NIM 이미지 모델 후보 점검: 평가용 쇼핑몰 상세 이미지 한 장을 후보 모델마다 보내
// 한국어 글자를 읽는지, 얼마나 걸리는지 보여준다. 기본 모델이 서비스 종료됐을 때 대체 모델을 고르는 용도.
// 사용법: NVIDIA_API_KEY=... node nim-models.mjs [모델 ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSCRIBE_PROMPT } from '../extension/lib/structure.js';
import { NIM_RECOMMENDED_MODELS } from '../extension/lib/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
// 후보는 설정 화면의 추천 모델과 같은 목록을 쓴다.
const CANDIDATES = NIM_RECOMMENDED_MODELS;
// detail-03.jpg(제품 사양, 사용 방법)에 실제로 적힌 글자. 많이 맞힐수록 좋다.
const EXPECT = ['500ml', '320g', '스테인리스 스틸 304', '트라이탄', '중성세제', '예열', '패킹'];

const key = process.env.NVIDIA_API_KEY;
if (!key) {
  console.error('NVIDIA_API_KEY 환경 변수가 필요합니다.');
  process.exit(1);
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
const image = fs.readFileSync(path.join(here, 'shop/images/detail-03.jpg')).toString('base64');

for (const model of models) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
              { type: 'text', text: TRANSCRIBE_PROMPT }
            ]
          }
        ],
        max_tokens: 2048,
        temperature: 0
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`실패 ${model} (${res.status}) ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const text = ((await res.json()).choices?.[0]?.message?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    const hits = EXPECT.filter((word) => text.includes(word)).length;
    console.log(`성공 ${model}: ${seconds}초, 정답 단어 ${hits}/${EXPECT.length}`);
    console.log(`  ${text.replace(/\s+/g, ' ').slice(0, 150)}`);
  } catch (error) {
    console.log(`실패 ${model}: ${error.message}`);
  }
}
