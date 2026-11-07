# 평가용 웹 서비스 운영 가이드 (systemd)

테스트 서버(SSU-DEV)에서 온글몰, 평가용 쇼핑몰, 평가 설문을 **8080 포트 하나**로 띄우고, 서버가 다시 켜져도 자동으로 살아나게 하는 방법입니다. 터미널을 닫아도 계속 돌고, 멈추면 3초 뒤 다시 켜집니다.

| 주소 | 내용 |
|---|---|
| `/mall/` | 가상 쇼핑몰 온글몰 (주문·결제까지). 첫 주소 `/`도 여기로 감 |
| `/shop/` | 평가용 쇼핑몰 상품 페이지 |
| `/survey/admin` | 평가 설문 관리자 |
| `/survey/s/<토큰>` | 설문 응답 링크 (관리자 화면에서 복사) |
| `/healthz` | 살아 있는지 확인용 (`ok`) |

한 포트만 쓰므로 nginx는 8080 하나만 넘겨주면 됩니다. 설문을 따로 띄우던 8090 포트는 더 쓰지 않습니다.

## 1. 처음 설치

저장소가 `/opt/ssu/SSUcreamMaker`, 실행 계정이 `ssu`라고 가정합니다. 다르면 서비스 파일의 `User`, `Group`, `WorkingDirectory`를 고칩니다.

**① 예전에 nohup으로 띄운 서버를 끈다** (8080·8090 포트를 비움)

```bash
cd /opt/ssu/SSUcreamMaker/eval
pkill -f shop/serve.mjs; pkill -f survey/server.mjs; rm -f mall.pid survey.pid
pgrep -af "serve.mjs|server.mjs"   # 아무것도 안 나오면 됨
```

**② 최신 코드를 받는다**

```bash
git switch main && git pull
```

**③ node 경로를 확인한다**

```bash
command -v node   # 예: /usr/bin/node
```

`/usr/bin/node`가 아니면 서비스 파일의 `ExecStart=` 경로를 그 값으로 고칩니다. nvm처럼 홈 폴더(`/home/...`)에 설치한 node라면 서비스 파일의 `ProtectHome=true`를 `ProtectHome=read-only`로 바꿉니다.

**④ 설정 파일(비밀번호)을 만든다**

```bash
sudo cp deploy/ongeul-eval-web.env.example /etc/ongeul-eval-web.env
sudo chmod 600 /etc/ongeul-eval-web.env && sudo chown root:root /etc/ongeul-eval-web.env
sudo vi /etc/ongeul-eval-web.env   # SURVEY_ADMIN_PASSWORD, HOST 고치기
```

- `HOST`: nginx가 같은 서버에서 넘겨주면 `127.0.0.1`(밖에서 8080으로 바로 못 들어옴, 권장). 다른 PC에서 `http://<서버 IP>:8080`으로 바로 열려면 `0.0.0.0`.
- `SURVEY_ADMIN_PASSWORD`: 따옴표나 `\`는 쓰지 않습니다. 비워 두면 설문만 꺼지고 쇼핑몰은 열립니다.
- 비밀번호가 이 파일에만 있으므로 명령 기록(`history`)에 남지 않습니다.

**⑤ 서비스를 등록하고 켠다**

```bash
sudo cp deploy/ongeul-eval-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ongeul-eval-web
systemctl status ongeul-eval-web --no-pager
curl -s http://127.0.0.1:8080/healthz   # ok (survey on)
```

## 2. nginx

nginx가 사이트 전체(`/`)를 8080으로 넘기고 있다면 **고칠 것이 없습니다.** `/survey/`도 같은 곳으로 갑니다.

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}
```

- 설문 서비스는 `/survey`로 시작하는 주소를 직접 만들기 때문에, nginx에서 앞부분을 떼어 내는 설정(`location /ongeul/ { proxy_pass http://127.0.0.1:8080/; }` 같은)과는 맞지 않습니다. 사이트 뿌리(`/`)째 넘겨주세요.
- 예전에 8090을 넘기던 설정이 있으면 지워도 됩니다.
- SELinux를 쓰는 서버에서 nginx가 8080에 연결하지 못하면(`502`, 로그에 `Permission denied`) `sudo setsebool -P httpd_can_network_connect 1`.

## 3. 자주 쓰는 명령

| 하려는 일 | 명령 |
|---|---|
| 상태 보기 | `systemctl status ongeul-eval-web --no-pager` |
| 로그 보기 (계속) | `journalctl -u ongeul-eval-web -f` |
| 최근 로그 100줄 | `journalctl -u ongeul-eval-web -n 100 --no-pager` |
| 끄기 / 켜기 | `sudo systemctl stop ongeul-eval-web` / `sudo systemctl start ongeul-eval-web` |
| 다시 켜기 | `sudo systemctl restart ongeul-eval-web` |
| 서버 부팅 때 자동 시작 끄기 | `sudo systemctl disable ongeul-eval-web` |
| 비밀번호·포트 바꾼 뒤 | `/etc/ongeul-eval-web.env` 고치고 `sudo systemctl restart ongeul-eval-web` |
| 서비스 파일 고친 뒤 | `sudo cp deploy/ongeul-eval-web.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart ongeul-eval-web` |

## 4. 코드 바꾼 뒤 반영

```bash
cd /opt/ssu/SSUcreamMaker && git pull
sudo systemctl restart ongeul-eval-web
```

화면 파일(HTML·CSS·JS·이미지)만 바뀌었으면 다시 켜지 않아도 되고, 브라우저에서 강력 새로고침(`Ctrl+Shift+R`)만 하면 됩니다. 서버 코드(`web.mjs`, `shop/serve.mjs`, `survey/*.mjs`, `survey/*.js`)가 바뀌었으면 다시 켭니다.

## 5. 설문 데이터

- 응답은 그대로 `eval/survey/data/`에 남습니다. 8090으로 띄우던 때 받은 응답도 그대로 보입니다(같은 폴더).
- **응답 링크 주소가 바뀝니다.** 예전 `http://<서버>:8090/s/<토큰>`은 `http(s)://<사이트>/survey/s/<토큰>`이 됩니다(토큰은 같음). 이미 보낸 링크가 있으면 관리자 화면에서 새 링크를 복사해 다시 보내세요.
- 관리자 로그인은 서비스를 다시 켜면 풀립니다(다시 로그인).
- 백업은 `eval/survey/data/` 폴더를 복사하면 됩니다.

## 6. 문제 해결

| 증상 | 확인 |
|---|---|
| `status`가 `failed`, 로그에 `EADDRINUSE` | 예전 nohup 서버가 8080을 쓰는 중. 1-① 다시 하고 `restart` |
| 로그에 `status=203/EXEC` | `ExecStart`의 node 경로가 틀림. `command -v node`로 확인 (1-③) |
| 로그에 `EACCES` (`survey/data`) | 실행 계정이 저장소 폴더에 쓸 수 없음. `sudo chown -R ssu:ssu /opt/ssu/SSUcreamMaker/eval/survey` |
| `/survey/admin`이 "설문 서비스가 꺼져 있습니다" | `/etc/ongeul-eval-web.env`에 `SURVEY_ADMIN_PASSWORD`가 없음 |
| 로그인 직후 다시 로그인 화면 | 브라우저가 쿠키를 막음, 또는 nginx가 `/survey` 앞부분을 떼어 냄 (2장) |
| 서비스 없이 잠깐 띄워 보기 | `cd eval && SURVEY_ADMIN_PASSWORD='비밀번호' npm run web` (`Ctrl+C`로 끔) |
