# Changelog

## [Unreleased]
### Added
- 쇼핑몰 상세 이미지 속 글자를 AI로 읽어 스크린리더가 읽을 수 있는 텍스트로 넣어주는 크로미움 확장 프로그램 — 상품 페이지에서 `Alt+Shift+D`(또는 툴바 아이콘)를 누르면 첫 상세 이미지 앞에 "상세 이미지 내용, AI 추출" 제목과 항목별 소제목(가격·할인, 옵션·구성, 주의사항 등)이 생기고 그 위치로 이동
- 확장 설정 화면: AI 켜기/끄기(기본 꺼짐), AI 공급자 선택(Google Gemini / NVIDIA NIM), API 키·모델 입력, 직접 설치한 NIM 주소 입력, 연결 확인. API 키는 이 브라우저에만 저장되고 동기화되지 않음. NVIDIA 무료 키는 개발·테스트 용도로만 사용
- 기획서 `docs/PROPOSAL.md`, README 설치·설정·사용법
- 단위 테스트(`npm test`, Node 내장 테스트 러너)
- PR 검증 CI(`ci.yml`): `main`으로 들어오는 PR마다 단위 테스트 실행
- 팀 협업 규칙 스킬(`.claude/skills/collab-rules`)과 프로젝트 `CLAUDE.md` — SMS 프로젝트와 같은 버전 관리·브랜치·커밋·릴리즈 규칙
