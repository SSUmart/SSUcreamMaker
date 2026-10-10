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

// results: [{ provider, caseId, ok, ms, score?, error? }]
export function summarize(results) {
  const providers = [...new Set(results.map((r) => r.provider))];
  return providers.map((provider) => {
    const rows = results.filter((r) => r.provider === provider);
    const ok = rows.filter((r) => r.ok);
    const scored = ok.filter((r) => r.score?.total);
    return {
      provider,
      cases: rows.length,
      errors: rows.length - ok.length,
      recall: average(scored.map((r) => r.score.recall)),
      sectionAccuracy: average(scored.map((r) => r.score.sectionAccuracy)),
      medianMs: median(ok.map((r) => r.ms))
    };
  });
}

const pct = (v) => (v === null ? '-' : `${Math.round(v * 100)}%`);
const sec = (ms) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}초`);

export function toMarkdown(summary, results) {
  const lines = [
    '| 공급자 | 사례 | 오류 | 글자 인식률 | 분류 정확도 | 소요 시간(중앙값) |',
    '|---|---|---|---|---|---|',
    ...summary.map(
      (s) =>
        `| ${s.provider} | ${s.cases} | ${s.errors} | ${pct(s.recall)} | ${pct(s.sectionAccuracy)} | ${sec(s.medianMs)} |`
    ),
    '',
    '| 공급자 | 사례 | 결과 | 글자 인식률 | 분류 정확도 | 소요 시간 | 비고 |',
    '|---|---|---|---|---|---|---|'
  ];
  for (const r of results) {
    const note = r.ok
      ? [...(r.score?.missing ?? []).map((m) => `누락 ${m}`), r.notice].filter(Boolean).join('; ')
      : r.error;
    lines.push(
      `| ${r.provider} | ${r.caseId} | ${r.ok ? '성공' : '실패'} | ${pct(r.score?.recall ?? null)} | ${pct(
        r.score?.sectionAccuracy ?? null
      )} | ${sec(r.ms ?? null)} | ${note || ''} |`
    );
  }
  return lines.join('\n');
}
