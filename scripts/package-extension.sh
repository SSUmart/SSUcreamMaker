#!/usr/bin/env bash
# 확장 프로그램을 배포용 zip으로 묶는다. 버전은 태그에서 만든다 (collab-rules 1장).
#   scripts/package-extension.sh v26.1.0-beta.2   → dist/ongeul-v26.1.0-beta.2.zip
#   scripts/package-extension.sh                  → dist/ongeul-<커밋>.zip (버전 0.0.0)
#
# Chrome의 version은 숫자 4자리까지만 허용하므로 네 번째 자리에 베타 번호(정식은 99)를 넣어
# 항상 커지게 한다. 확장 관리 화면에는 version_name(원래 버전)이 보인다.
#   v26.1.0-beta.2 → version 26.1.0.2,  version_name 26.1.0-beta.2
#   v26.1.0        → version 26.1.0.99, version_name 26.1.0
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-}"

if [ -n "$tag" ]; then
  if ! [[ "$tag" =~ ^v([0-9]{2})\.([0-9]{1,2})\.([0-9]{1,2})(-beta\.([1-9]|[1-8][0-9]|9[0-8]))?$ ]]; then
    echo "태그는 v26.1.0 또는 v26.1.0-beta.1 형식이어야 합니다 (메이저·마이너 0~99, 베타 1~98): $tag" >&2
    exit 1
  fi
  yy="${BASH_REMATCH[1]}" major="${BASH_REMATCH[2]}" minor="${BASH_REMATCH[3]}" beta="${BASH_REMATCH[5]:-99}"
  version="$((10#$yy)).$((10#$major)).$((10#$minor)).$((10#$beta))"
  version_name="${tag#v}"
  name="ongeul-$tag"
else
  version="0.0.0"
  version_name="0.0.0-dev"
  name="ongeul-$(git -C "$root" rev-parse --short HEAD)"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# 테스트 코드와 숨김 파일(.DS_Store, 도구 상태 등)은 배포 파일에 넣지 않는다
rsync -a --exclude 'test/' --exclude '.*' "$root/extension/" "$work/"
node -e '
  const fs = require("fs");
  const [file, version, versionName] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.version = version;
  manifest.version_name = versionName;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
' "$work/manifest.json" "$version" "$version_name"

mkdir -p "$root/dist"
zip_path="$root/dist/$name.zip"
rm -f "$zip_path"
(cd "$work" && zip -qr -X "$zip_path" .)
echo "version=$version version_name=$version_name"
echo "$zip_path"
