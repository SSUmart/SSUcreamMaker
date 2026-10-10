# Changelog

## [Unreleased]
### Added
- 자동 릴리즈(`release.yml`): 버전 태그를 푸시하면 확장 프로그램 zip과 해당 버전의 릴리즈 노트(CHANGELOG)로 GitHub Release를 만듦. 베타(`v26.1.0-beta.1`)는 Pre-release로 배포. 수동 실행으로 zip만 받을 수도 있음. 같은 zip을 로컬에서 만드는 `scripts/package-extension.sh` 추가
- 확장 프로그램 아이콘(툴바·확장 관리 화면·웹스토어용 16/32/48/128px) — SMS 프로젝트(손울림)의 앱 아이콘(`frontend/assets/icon-foreground.png`)을 투명 배경 그대로 잘라 사용
- 상세 이미지 글자 추출 평가 도구(`eval/`): 실제 Chromium에 확장을 올려 상품 페이지마다 실행하고, 사람이 만든 정답과 비교해 Gemini·NVIDIA NIM의 글자 인식률, 분류 정확도, 소요 시간, 오류를 표로 보여줌. 정답이 확실한 평가용 이미지 사례(`fixture-basic`) 포함, 키 없이 도구만 점검하는 `--mock` 지원
- 쇼핑몰 상세 이미지 속 글자를 AI로 읽어 스크린리더가 읽을 수 있는 텍스트로 넣어주는 크로미움 확장 프로그램 — 상품 페이지에서 `Alt+Shift+D`(또는 툴바 아이콘)를 누르면 첫 상세 이미지 앞에 "상세 이미지 내용, AI 추출" 제목과 항목별 소제목(가격·할인, 옵션·구성, 주의사항 등)이 생기고 그 위치로 이동
- 확장 설정 화면: AI 켜기/끄기(기본 꺼짐), AI 공급자 선택(Google Gemini / NVIDIA NIM), API 키·모델 입력, 직접 설치한 NIM 주소 입력, 연결 확인. API 키는 이 브라우저에만 저장되고 동기화되지 않음. NVIDIA 무료 키는 개발·테스트 용도로만 사용
- 기획서 `docs/PROPOSAL.md`, README 설치·설정·사용법
- 단위 테스트(`npm test`, Node 내장 테스트 러너)
- PR 검증 CI(`ci.yml`): `main`으로 들어오는 PR마다 단위 테스트 실행
- 팀 협업 규칙 스킬(`.claude/skills/collab-rules`)과 프로젝트 `CLAUDE.md` — SMS 프로젝트와 같은 버전 관리·브랜치·커밋·릴리즈 규칙

### Changed
- 협업 규칙에 릴리즈 절차 확정: 태그로 manifest 버전(`26.1.0-beta.2` → `26.1.0.2`, 정식은 `26.1.0.99`)을 만들고 zip을 GitHub Release에 올림. 웹스토어 배포는 하지 않음

### Removed
- 실수로 커밋된 개발 도구 상태 파일(`extension/options/.omc/`)
