#!/bin/sh
# 온글 연결 프로그램 설치 (macOS, Linux). 제거: sh install.sh --uninstall
# Node.js 20 이상과 OpenAI Codex CLI가 필요합니다. 안내: docs/CHATGPT-LOGIN.md
cd "$(dirname "$0")" || exit 1
node=$(command -v node)
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
  [ -n "$node" ] && break
  [ -x "$candidate" ] && node=$candidate
done
if [ -z "$node" ]; then
  echo "Node.js를 찾지 못했습니다. https://nodejs.org 에서 Node.js 20 이상(LTS)을 설치한 뒤 다시 실행하세요."
  exit 1
fi
exec "$node" install.mjs "$@"
