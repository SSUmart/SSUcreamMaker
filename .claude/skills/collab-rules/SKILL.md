---
name: collab-rules
description: SSUcreamMaker 팀 공통 협업 규칙 — 버전 관리(연도.메이저.마이너), CHANGELOG.md 작성, 브랜치·커밋·머지 규칙, 머지 후 브랜치 정리·복원. 코드 변경, 버전 업, 커밋, 푸시, PR, 머지, 브랜치 정리·복원, 릴리즈·베타(사전 릴리즈) 작업 전에 반드시 확인한다.
---

# SSUcreamMaker 협업 규칙

같은 조직(SSUmart)의 SMS 프로젝트 협업 규칙을 따른다. 이 프로젝트에 해당하지 않는 부분(APK, Docker 이미지)은 뺐다.

## 1. 버전 관리

### 버전 형식: `연도.메이저.마이너`
예: `26.1.0`, `26.1.1`, `26.2.0` (연도는 뒤 두 자리)

| 자리 | 올리는 경우 | 예시 |
|---|---|---|
| 연도 | 해가 바뀐 뒤 첫 릴리즈 (메이저 1, 마이너 0부터 다시 시작) | `26.3.2` → `27.1.0` |
| 메이저 | **새 기능이 추가되는 큰 업데이트**일 때만 (마이너는 0으로) | `26.1.3` → `26.2.0` |
| 마이너 | 버그 수정, 기능 개선 같은 작은 작업 | `26.1.0` → `26.1.1` |

- **버전은 `CHANGELOG.md`와 릴리즈 태그(`v26.1.0`)로만 관리한다.** 릴리즈할 때 고치는 파일은 `CHANGELOG.md` 하나다
  - `extension/manifest.json`, `package.json`, `eval/package.json`의 `version`은 `0.0.0`으로 고정하고 바꾸지 않는다
  - 배포용 zip의 manifest 버전은 CI가 태그에서 만든다 (`scripts/package-extension.sh`). Chrome의 `version`은 숫자만 허용하므로 네 번째 자리에 베타 번호(정식은 99)를 넣어 항상 커지게 한다. 확장 관리 화면에는 `version_name`(원래 버전)이 보인다

    | 태그 | `version` | `version_name` |
    |---|---|---|
    | `v26.1.0-beta.2` | `26.1.0.2` | `26.1.0-beta.2` |
    | `v26.1.0` | `26.1.0.99` | `26.1.0` |
    | 태그 없음 (로컬) | `0.0.0` | `0.0.0-dev` |

    그래서 메이저·마이너는 0~99, 베타 번호는 1~98까지 쓴다
- 애매하면 마이너로 올린다. 메이저인지 판단이 안 서면 팀에 묻는다.

### 베타(사전 릴리즈): `연도.메이저.마이너-beta.번호`
**배포는 기본적으로 베타로 한다.** 정식 릴리즈는 팀(사용자)이 명시적으로 요청했을 때만 한다.
- 다음에 낼 정식 버전 뒤에 `-beta.1`, `-beta.2`…를 붙인다 (예: `26.1.0-beta.1` → `26.1.0-beta.2` → `26.1.0`)
- 베타도 하나의 버전이다. `CHANGELOG.md`에 `## [26.1.0-beta.1] - 날짜`로 따로 기록한다
- GitHub Release에는 **Pre-release**로 올라간다. 정식 릴리즈의 노트에는 그 버전과 같은 버전의 베타 항목이 모두 들어간다

### 릴리즈 노트: 저장소 루트 `CHANGELOG.md`
변경된 **모든 버전**은 반드시 기록한다. 최신 버전이 맨 위로 온다.

```markdown
# Changelog

## [26.1.1] - 2026-10-02
### Fixed
- 상세 이미지가 여러 장일 때 일부만 읽히던 문제 수정

## [26.1.0] - 2026-10-01
### Added
- 상세 이미지 속 글자를 AI로 읽어 텍스트로 삽입
```

- 분류: `Added`(새 기능) / `Changed`(개선·변경) / `Fixed`(버그 수정) / `Removed`(삭제). 해당 없는 분류는 생략한다.
- 아직 버전을 정하지 않은 작업은 맨 위 `## [Unreleased]`에 쌓아 두고, 버전을 확정할 때 번호와 날짜를 붙인다.
- 사용자(팀원·사용자)가 읽고 이해할 수 있는 문장으로 쓴다. 커밋 메시지를 그대로 복사하지 않는다.

## 2. 브랜치 전략: GitHub Flow

```
main ──●────────●──────────●──────   항상 동작하는 상태, 릴리즈는 태그(v26.1.0)
        \      /  \       /
  feature/xxx ●     fix/yyy ●       작업 브랜치 → PR → squash merge → 삭제
```

- 오래 유지하는 브랜치는 `main` 하나뿐이다. `develop`, `release/` 같은 브랜치는 두지 않는다.
- `main`은 언제나 실행 가능한 상태로 유지한다. 직접 커밋·푸시·force push를 하지 않는다.
- 모든 작업은 `main`에서 갈라진 **작업 브랜치**에서 하고, PR 머지로만 `main`에 반영한다.
- 작업 브랜치는 짧게 유지한다(가능하면 며칠 안에 머지). 머지 후 바로 삭제한다. 삭제해도 커밋은 PR에 남아 복원할 수 있다(7장).

### 작업 브랜치 이름: `종류/짧은-설명` (영문 소문자, 하이픈 구분)

| 종류 | 용도 | 예시 |
|---|---|---|
| `feature/` | 새 기능 | `feature/detail-text-extraction` |
| `fix/` | 버그 수정 | `fix/lazy-image-url` |
| `refactor/` | 동작 변경 없는 구조 개선 | `refactor/provider-module` |
| `docs/` | 문서 | `docs/readme-setup` |
| `chore/` | 설정, 의존성, 빌드, 릴리즈 | `chore/release-26.1.0` |

## 3. 커밋 규칙

### 요청 전에는 커밋·푸시 금지
- 명시적인 요청이 있기 전까지 `git commit`, `git push`, PR 생성·머지, 태그 생성을 하지 않는다.
- 작업이 끝나면 변경 내용과 검증 결과만 보고하고 커밋 여부를 묻는다.
- 현재 브랜치가 `main`이면 커밋 전에 반드시 작업 브랜치를 만든다.

### 커밋 메시지
```
[브랜치명] 변경 요약

(선택) 무엇을, 왜 바꿨는지
```
예: `[fix/lazy-image-url] 지연 로딩 이미지 주소를 찾지 못하던 문제 수정`

- 하나의 커밋에는 하나의 목적만 담는다.
- 커밋하지 않는 것: `node_modules/`, `dist/`, `.omc/`, 비밀 키(API 키 포함), `.env`

## 4. 작업 → 머지 절차

1. 작업 브랜치 생성: `git switch main && git pull && git switch -c feature/xxx`
2. 작업 후 테스트 통과 확인: `npm test`
   (PR을 만들면 GitHub Actions `CI`가 같은 검사를 다시 돌린다. 실패하면 머지하지 않는다)
   - 확장 동작을 바꿨다면 `chrome://extensions`에서 새로고침 후 실제 페이지에서도 확인한다
3. `CHANGELOG.md`의 `## [Unreleased]`에 변경 내용 기록
4. (요청 시) 커밋 → `git push -u origin feature/xxx` → GitHub PR 생성 (본문에 변경 요약·테스트 결과)
   - **PR의 base는 항상 `main`**으로 만든다. 다른 작업 브랜치를 base로 하는 PR(쌓은 PR)은 만들지 않는다.
   - 앞선 PR에 의존하는 작업이면 앞선 PR이 머지될 때까지 기다렸다가, 최신 `main`에서 브랜치를 만들어 작업한다.
   - 쌓은 PR을 피할 수 없었다면, 앞선 PR이 머지된 뒤 base를 `main`으로 바꾸고 rebase한 다음 머지한다. base가 작업 브랜치인 채로 머지하면 `main`이 아니라 그 브랜치에 들어간다.
   - PR 제목은 커밋 메시지 형식(`[브랜치명] 변경 요약`)을 따른다.
5. 리뷰 1명 승인 후 머지 버튼에서 **Squash and merge**를 고른다 (PR 제목이 `main`의 커밋 메시지가 됨). 머지 전에 base가 `main`인지 확인한다.
6. 원격 작업 브랜치는 자동 삭제된다(6장 설정). 로컬 브랜치를 정리한다.
   ```bash
   git switch main && git pull --prune
   git branch -D feature/xxx   # squash 머지라 -d 는 "병합되지 않음"으로 거부되므로 -D 사용
   ```
   `-D` 전에 `git diff feature/xxx main`으로 머지되지 않은 변경이 없는지 확인한다.

## 5. 릴리즈 절차

베타·정식 모두 같은 절차다. 별도 요청이 없으면 **베타**(`26.1.0-beta.N`)로 진행한다.
태그를 푸시하면 GitHub Actions(`.github/workflows/release.yml`)가 Release를 만든다. Release를 손으로 만들지 않는다.

1. `chore/release-<버전>` 브랜치 생성 (예: `chore/release-26.1.0-beta.1`)
2. `CHANGELOG.md`의 `[Unreleased]` → `[26.1.0-beta.1] - 날짜`로 확정, 비어 있는 `[Unreleased]` 다시 추가 (**바꾸는 파일은 이것 하나**)
3. PR → CI 통과 → squash merge
4. (요청 시) 머지된 `main` 커밋에 태그 푸시
   ```bash
   git switch main && git pull
   git tag v26.1.0-beta.1 && git push origin v26.1.0-beta.1
   ```
5. Actions가 끝나면 Release가 열린다. 베타는 Pre-release, 정식은 Latest로 표시된다.

| Release 구성 | 내용 |
|---|---|
| 본문 | `CHANGELOG.md`의 해당 버전 항목 (정식은 같은 버전의 베타 항목 포함) |
| `ssucreammaker-v<버전>.zip` | 확장 프로그램. 압축을 풀어 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드"로 설치. 테스트 코드는 빠져 있다 |

- 태그 형식이 `v연도.메이저.마이너` 또는 `…-beta.번호`가 아니거나, CHANGELOG에 그 버전 항목이 없거나, `npm test`가 실패하면 Release는 만들어지지 않는다.
- 같은 zip을 로컬에서 만들려면 `scripts/package-extension.sh v26.1.0-beta.1` (결과는 `dist/`, 커밋하지 않음).
- 태그 없이 zip만 필요하면 Actions → Release → **Run workflow**로 수동 실행하고, 결과 페이지의 `ssucreammaker-extension`을 받는다.
- Chrome 웹스토어 배포는 하지 않는다. 필요해지면 팀이 정한 뒤 권한 축소(`<all_urls>` → 허용한 사이트만)와 함께 추가한다.
- 베타에서 고칠 것이 나오면 일반 작업 브랜치 → PR로 고친 뒤 다음 베타(`-beta.2`)로 다시 릴리즈한다.

## 6. 저장소 설정 (관리자, 1회)

- Settings → Branches → `main` 보호: PR 필수, 승인 1명, force push·삭제 금지
  - 비공개 저장소의 무료 플랜에서는 브랜치 보호를 쓸 수 없다. 그 경우 이 규칙을 팀이 지켜서 대신한다.
- Settings → General → Pull Requests: Squash merging만 허용, "Automatically delete head branches" 켜기
  - squash만 허용해야 머지 방식 실수(일반 merge 커밋)가 생기지 않는다.
  - 자동 삭제가 켜져 있으면, 쌓은 PR이 있을 때 GitHub가 그 PR의 base를 `main`으로 자동으로 바꿔 준다.

## 7. 머지 후 브랜치 복원

squash 머지 후 작업 브랜치가 삭제되어도 **커밋은 사라지지 않는다.** GitHub는 PR마다 마지막 커밋을 `refs/pull/<PR번호>/head`로 계속 보관한다.

| 상황 | 방법 |
|---|---|
| 브랜치를 그대로 되살리기 | 머지된 PR 화면 맨 아래 **Restore branch** 버튼 |
| 작업 커밋을 하나씩 보거나 일부만 가져오기 | `git fetch origin pull/<PR번호>/head:restore/<이름>` → `git log restore/<이름>` → 필요하면 `git cherry-pick <커밋>` |
| `main`에서 그 PR 변경 전체를 빼기 | `fix/revert-<짧은-설명>` 브랜치에서 `git revert <squash 커밋>` → PR (squash 커밋 하나만 되돌리면 됨) |
| 특정 릴리즈 상태로 돌아가기 | 릴리즈 태그 사용: `git switch -c fix/xxx v26.1.0` |

- PR 번호는 squash 커밋 메시지 끝의 `(#8)`이나 `gh pr list --state merged`로 찾는다.
- 복원용 브랜치(`restore/…`)는 로컬에서만 쓰고, 다시 `main`에 넣을 변경은 일반 작업 브랜치 → PR 절차를 따른다.
