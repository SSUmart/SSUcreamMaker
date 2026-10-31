// 평가 도구가 함께 쓰는 것: AI 공급자 설정(환경 변수), 실행 조건 기록.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NIM_RECOMMENDED_MODELS } from '../extension/lib/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// 공급자 설정은 환경 변수에서 읽는다. 키를 파일에 쓰지 않기 위함.
export function providerSettings(name, mockBaseUrl) {
  if (name === 'gemini') {
    return {
      provider: 'gemini',
      gemini: { apiKey: process.env.GEMINI_API_KEY ?? '', model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' }
    };
  }
  if (name === 'nim') {
    if (!process.env.NVIDIA_MODEL) {
      throw new Error(`NVIDIA_MODEL 환경 변수로 NIM 모델을 정해주세요. 추천 후보: ${NIM_RECOMMENDED_MODELS.join(', ')}`);
    }
    return {
      provider: 'nim',
      nim: {
        apiKey: process.env.NVIDIA_API_KEY ?? '',
        model: process.env.NVIDIA_MODEL,
        baseUrl: process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1'
      }
    };
  }
  if (name === 'mock') {
    // 평가 도구 자체 점검용. 가짜 AI 서버가 정해진 답을 돌려준다.
    return { provider: 'nim', nim: { apiKey: 'mock', model: 'mock', baseUrl: mockBaseUrl } };
  }
  throw new Error(`알 수 없는 공급자: ${name}`);
}

export function chooseProviders({ mock = false, providers } = {}) {
  if (mock) return ['mock'];
  if (providers) return providers.split(',').map((p) => p.trim());
  const found = [];
  if (process.env.GEMINI_API_KEY) found.push('gemini');
  if (process.env.NVIDIA_API_KEY) found.push('nim');
  if (!found.length) {
    throw new Error('GEMINI_API_KEY 또는 NVIDIA_API_KEY 환경 변수가 필요합니다. 도구 점검만 하려면 --mock');
  }
  return found;
}

// 결과만 보고도 어떤 조건에서 돌렸는지 알 수 있게 코드 버전을 남긴다.
// 커밋하지 않은 변경이 있으면 dirty로 표시한다(그 결과는 커밋만으로 다시 만들 수 없다).
export function gitVersion() {
  const git = (...cmd) => execFileSync('git', cmd, { cwd: here, encoding: 'utf8' }).trim();
  try {
    return { commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' };
  } catch {
    return { commit: null, dirty: null };
  }
}

// 공급자 설정에서 모델 이름만 뽑는다. API 키는 결과 파일에 남기지 않는다.
export function modelOf(settings) {
  return settings[settings.provider]?.model ?? null;
}

// 영구 컨텍스트는 browser()가 null이라 확장의 서비스 워커에서 읽는다. userAgent는 뒷자리를 0으로 감춘다
export function chromiumVersion(sw) {
  return sw.evaluate(async () => {
    const { fullVersionList = [] } = (await navigator.userAgentData?.getHighEntropyValues(['fullVersionList'])) ?? {};
    return fullVersionList.find((b) => b.brand === 'Chromium')?.version ?? null;
  });
}

// 확장은 설치 직후 설정 탭을 연다. 이 탭이 평가용 탭을 가로채지 않도록 열릴 때까지 기다렸다 닫는다.
export async function closeOptionsTab(context) {
  for (let i = 0; i < 50; i++) {
    const tab = context.pages().find((p) => p.url().includes('/options/options.html'));
    if (tab) return tab.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// 지연 로딩되는 상세 이미지를 불러오도록 끝까지 천천히 내린다.
export async function scrollThrough(page) {
  for (let i = 0; i < 40; i++) {
    const atBottom = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    });
    await page.waitForTimeout(250);
    if (atBottom) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}
