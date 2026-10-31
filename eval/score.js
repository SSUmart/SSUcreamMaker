// 확장이 넣은 결과(섹션 목록)를 사람이 만든 정답과 비교한다.
// 정답은 섹션 제목별 "반드시 들어 있어야 할 문구" 목록이다.

// 띄어쓰기·쉼표·대소문자 차이는 같은 것으로 본다. ("39,000 원" == "39000원")
export function normalize(text) {
  return text.toLowerCase().replace(/[\s,]/g, '');
}

export function scoreCase(sections, expect) {
  const allItems = sections.flatMap((s) => s.items).map(normalize);
  let total = 0;
  let found = 0;
  let inSection = 0;
  const missing = [];
  const misplaced = [];

  for (const [title, facts] of Object.entries(expect)) {
    const sectionItems = (sections.find((s) => s.title === title)?.items ?? []).map(normalize);
    for (const fact of facts) {
      total++;
      const f = normalize(fact);
      const anywhere = allItems.some((item) => item.includes(f));
      const right = sectionItems.some((item) => item.includes(f));
      if (anywhere) found++;
      else missing.push(`${title}: ${fact}`);
      if (right) inSection++;
      else if (anywhere) misplaced.push(`${title}: ${fact}`);
    }
  }

  return {
    total,
    // 정답 문구 중 결과 어딘가에 나온 비율 (글자를 제대로 읽었는가)
    recall: total ? found / total : null,
    // 정답 문구 중 맞는 섹션에 들어간 비율 (제대로 분류했는가)
    sectionAccuracy: total ? inSection / total : null,
    missing,
    misplaced
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// 느린 쪽 시간(p95)은 가장 가까운 순위 방식으로 고른다. 실행이 20번보다 적으면 사실상 가장 느린 값이다.
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function minimum(values) {
  return values.length ? Math.min(...values) : null;
}

// 같은 rows(한 공급자 또는 한 사례의 반복 실행)를 묶어 잰다. 실패는 비율과 시간에서 빼고 오류로 센다.
function aggregate(rows) {
  const ok = rows.filter((r) => r.ok);
  const scored = ok.filter((r) => r.score?.total);
  const recalls = scored.map((r) => r.score.recall);
  const times = ok.map((r) => r.ms);
  return {
    errors: rows.length - ok.length,
    recall: average(recalls),
    minRecall: minimum(recalls),
    sectionAccuracy: average(scored.map((r) => r.score.sectionAccuracy)),
    medianMs: median(times),
    p95Ms: percentile(times, 95)
  };
}

// results: [{ provider, caseId, run?, ok, ms, score?, error? }]
export function summarize(results) {
  const providers = [...new Set(results.map((r) => r.provider))];
  return providers.map((provider) => {
    const rows = results.filter((r) => r.provider === provider);
    return { provider, cases: rows.length, ...aggregate(rows) };
  });
}

// 사례마다 반복 실행을 묶는다. 같은 사례를 여러 번 돌렸을 때 결과가 얼마나 흔들리는지 본다.
export function summarizeCases(results) {
  const keys = [...new Set(results.map((r) => `${r.provider}\u0000${r.caseId}`))];
  return keys.map((key) => {
    const [provider, caseId] = key.split('\u0000');
    const rows = results.filter((r) => r.provider === provider && r.caseId === caseId);
    return { provider, caseId, runs: rows.length, ...aggregate(rows) };
  });
}

const pct = (v) => (v === null ? '-' : `${Math.round(v * 100)}%`);
const sec = (ms) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}초`);

export function toMarkdown(summary, results) {
  const lines = [
    '| 공급자 | 실행 | 오류 | 글자 인식률 | 분류 정확도 | 소요 시간(중앙값) | 느린 쪽(p95) |',
    '|---|---|---|---|---|---|---|',
    ...summary.map(
      (s) =>
        `| ${s.provider} | ${s.cases} | ${s.errors} | ${pct(s.recall)} | ${pct(s.sectionAccuracy)} | ${sec(
          s.medianMs
        )} | ${sec(s.p95Ms)} |`
    )
  ];

  const byCase = summarizeCases(results);
  if (byCase.some((c) => c.runs > 1)) {
    lines.push(
      '',
      '| 공급자 | 사례 | 실행 | 오류 | 인식률 평균 | 인식률 최저 | 분류 정확도 | 중앙값 | p95 |',
      '|---|---|---|---|---|---|---|---|---|',
      ...byCase.map(
        (c) =>
          `| ${c.provider} | ${c.caseId} | ${c.runs} | ${c.errors} | ${pct(c.recall)} | ${pct(c.minRecall)} | ${pct(
            c.sectionAccuracy
          )} | ${sec(c.medianMs)} | ${sec(c.p95Ms)} |`
      )
    );
  }

  lines.push(
    '',
    '| 공급자 | 사례 | 회차 | 결과 | 글자 인식률 | 분류 정확도 | 소요 시간 | 비고 |',
    '|---|---|---|---|---|---|---|---|'
  );
  for (const r of results) {
    const note = r.ok
      ? [...(r.score?.missing ?? []).map((m) => `누락 ${m}`), r.notice].filter(Boolean).join('; ')
      : r.error;
    lines.push(
      `| ${r.provider} | ${r.caseId} | ${r.run ?? 1} | ${r.ok ? '성공' : '실패'} | ${pct(r.score?.recall ?? null)} | ${pct(
        r.score?.sectionAccuracy ?? null
      )} | ${sec(r.ms ?? null)} | ${note || ''} |`
    );
  }
  return lines.join('\n');
}
