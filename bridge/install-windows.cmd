@echo off
chcp 65001 >nul
rem 온글 연결 프로그램 설치 (Windows). 제거는 uninstall-windows.cmd
cd /d "%~dp0"
rem 통합 zip이면 함께 담긴 Node.js를 쓴다
if exist "runtime\node\node.exe" (
  "runtime\node\node.exe" install.mjs %*
  echo.
  pause
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾지 못했습니다. https://nodejs.org 에서 Node.js 20 이상^(LTS^)을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
node install.mjs %*
echo.
pause
