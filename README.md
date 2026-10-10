# SSUcreamMaker
AI를 활용한 스크린리더 서비스 제공

쇼핑몰 상세페이지의 이미지 속 글자를 AI로 읽어, 스크린리더가 읽을 수 있는 텍스트로 페이지에 넣어주는 크로미움 확장 프로그램입니다. 읽기는 평소 쓰는 스크린리더(센스리더, NVDA, JAWS)가 그대로 합니다.

기획과 진행 단계는 [docs/PROPOSAL.md](docs/PROPOSAL.md)를 참고하세요.

## 설치 (개발 버전)

1. Chrome, Edge, Whale에서 `chrome://extensions` 열기 (Edge는 `edge://extensions`)
2. 개발자 모드 켜기
3. "압축해제된 확장 프로그램을 로드합니다"에서 `extension` 폴더 선택
4. 설치되면 설정 화면이 자동으로 열립니다.

## 설정

1. "AI로 상세 이미지 읽기 켜기" 체크
2. AI 공급자 선택
   - Google Gemini: [Google AI Studio](https://aistudio.google.com/)에서 API 키 발급
   - NVIDIA NIM: [build.nvidia.com](https://build.nvidia.com/)에서 API 키 발급. 직접 설치한 NIM을 쓰면 API 주소 변경. NVIDIA 무료 키는 개발·테스트 용도로만 쓸 수 있습니다.
3. API 키 입력 후 "저장", "연결 확인"으로 키 확인

- API 키는 이 브라우저에만 저장되며 동기화되지 않습니다.
- AI를 켜면 상세 이미지가 선택한 AI 서비스로 전송되고, 요금은 입력한 키의 계정에 청구됩니다.

## 사용

1. 쇼핑몰 상품 페이지에서 `Alt+Shift+D` (또는 툴바의 확장 아이콘)
2. 진행 상황을 스크린리더가 안내합니다.
3. 완료되면 첫 상세 이미지 앞에 "상세 이미지 내용, AI 추출" 제목이 생기고 그 위치로 이동합니다. 가격·할인, 옵션·구성, 주의사항 같은 소제목(h3)으로 이동하며 읽을 수 있습니다.

단축키는 `chrome://extensions/shortcuts`에서 바꿀 수 있습니다.

## 개발

```bash
npm test   # 단위 테스트 (Node 20 이상, 의존성 없음)
```

확장 코드를 고친 뒤에는 `chrome://extensions`에서 새로고침하세요.

브랜치·커밋·버전·CHANGELOG 규칙은 [협업 규칙](.claude/skills/collab-rules/SKILL.md)을 따릅니다. 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 기록합니다.
