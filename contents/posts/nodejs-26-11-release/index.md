---
title: "Node.js 26.11 릴리스: 서버 개발자가 챙겨 볼 변경 다섯 가지"
description: "10월 7일 나온 Node.js 26.11.0에서 HTTP 헤더 검증 함수, --process-timeout, node:sqlite 클래스 이름 변경, perf_hooks 히스토그램, 권한 모델 보안 수정을 릴리스 노트와 PR 기준으로 정리했다."
date: 2026-10-09T09:00:00
update: 2026-10-09T09:00:00
tags:
  - Node.js
  - Security
  - DevOps
---

Node.js 26.11.0이 10월 7일 나왔다. 같은 날 문서 빌드 관련 변경을 되돌린 26.11.1이 바로 뒤따라 나왔으니 실제로 올릴 버전은 26.11.1이다. 이번 릴리스는 semver-minor 변경이 많은데, 그중 서버 코드를 짜는 입장에서 실제로 손이 갈 만한 건 다섯 개 정도로 추려졌다. 특히 `node:sqlite`를 쓰고 있다면 클래스 이름이 바뀌었으니 먼저 확인해 두는 게 좋다.

> 26.11에서 백엔드 코드나 운영 방식에 영향을 주는 변경은 무엇이고, 지금 당장 해야 할 일이 있는가?

> 이 글은 Node.js 공식 릴리스 노트와 각 변경의 GitHub PR 설명을 읽고 정리했다. 26은 Current 라인이라 API 세부 동작은 바뀔 수 있고, 운영 서버는 보통 LTS를 쓰니 이 기능들이 언제 LTS에 들어오는지는 따로 확인해야 한다.

## 1. 한눈에 보는 변경

| 영역          | 변경                                                       | 영향                         |
| ------------- | ---------------------------------------------------------- | ---------------------------- |
| `http`        | `isValidHeaderName()`, `isValidHeaderValue()` 추가         | 헤더 검증을 예외 없이 처리   |
| CLI           | `--process-timeout` 플래그 추가                            | 멈춘 프로세스를 진단 후 종료 |
| `node:sqlite` | `DatabaseSync` → `Database`, `StatementSync` → `Statement` | 기존 코드 이름 점검 필요     |
| `perf_hooks`  | `histogram.snapshot()`, `histogram.diff()` 추가            | 구간별 지연 측정이 쉬워짐    |
| 권한 모델     | `Socket(fd)`로 `--allow-net`을 우회하던 문제 수정          | 권한 모델 사용자는 업데이트  |

이 밖에 `Buffer.stringLength()`, `process.ref`/`unref` 안정화, Alpine Linux tier 2 승격, OpenSSL 3.5.9 업데이트 같은 변경도 들어갔다.

## 2. HTTP 헤더 검증이 예외 없이 된다

기존에도 `http.validateHeaderName()`과 `http.validateHeaderValue()`가 있었는데, 둘 다 잘못된 값이면 예외를 던진다. 새로 들어온 `isValidHeaderName()`, `isValidHeaderValue()`는 같은 검사를 하고 결과를 boolean으로 돌려준다.

```js
const http = require("node:http")

if (!http.isValidHeaderValue(req.headers["x-trace-id"])) {
  res.statusCode = 400
  return res.end()
}
```

별것 아닌 차이 같지만 PR에 붙은 설명을 보니 이유가 성능이었다. 잘못된 헤더를 거를 때 기존 함수는 에러 객체와 스택 트레이스를 만드느라 몇 마이크로초가 걸리고, boolean 검사는 20ns 정도라고 한다. 사용자 입력을 그대로 헤더에 넣는 프록시나 게이트웨이처럼 잘못된 값이 자주 들어오는 경로라면 차이가 난다. `isValidHeaderValue()`는 `http.createServer()`의 `httpValidation`과 같은 의미의 `strict`, `relaxed` 옵션도 받는다고 적혀 있다.

## 3. --process-timeout: 멈춘 프로세스를 이유와 함께 종료

개인적으로 이번 릴리스에서 제일 반가웠던 건 이 플래그다. 지정한 시간이 지나면 별도 watchdog 스레드가 메인 스레드를 끊고, 그 시점의 JavaScript 스택과 이벤트 루프를 붙잡고 있는 리소스 목록을 출력한 뒤 종료 코드 124로 끝낸다. 메인 스레드가 네이티브 코드 안에서 멈춰 있어도 종료된다.

```bash
node --process-timeout=10s scripts/migrate.js
echo $?   # 시간 초과면 124
```

CI의 job 타임아웃이나 `timeout` 명령은 프로세스를 죽이기만 하고 무엇에 걸려 있었는지는 알려 주지 않는다. `setTimeout`으로 직접 감시하는 방법도 이벤트 루프가 바쁜 루프에 묶이면 아예 실행되지 않는다. 배치 작업, 마이그레이션 스크립트, 테스트 러너처럼 가끔 영원히 안 끝나는 프로세스가 있는 팀이라면 원인 찾는 시간이 꽤 줄 것 같다. 시간 단위 표기는 PR 예시의 `10s` 형식을 따랐으니 정확한 문법은 CLI 문서를 한 번 더 보자.

## 4. node:sqlite 클래스 이름 변경

`DatabaseSync`가 `Database`로, `StatementSync`가 `Statement`로 바뀌었다. 릴리스 노트에는 이름 변경만 적혀 있고, PR 설명에는 기존 이름을 alias로 남기고 문서상 deprecated(DEP0210) 처리한다고 돼 있다. 다만 PR 리뷰에서 런타임 경고를 띄울지를 두고 의견이 갈렸던 흔적이 있어서, 올리기 전에 직접 확인해 보는 게 안전하다.

```bash
node -e "const s = require('node:sqlite'); console.log(typeof s.Database, typeof s.DatabaseSync)"
```

둘 다 `function`이 나오면 기존 코드는 그대로 돌아간다. 새 코드는 처음부터 `Database`를 쓰는 편이 나중에 덜 귀찮다.

## 5. 지연 지표를 구간별로 보기

`perf_hooks` 히스토그램에 `snapshot()`과 `diff()`가 생겼다. `snapshot()`은 지금까지 기록된 값을 복사한 독립 히스토그램을 만들고, `diff()`는 두 시점 사이에 바뀐 부분만 담은 히스토그램을 돌려준다. `monitorEventLoopDelay()`로 이벤트 루프 지연을 재고 있다면 "최근 1분 동안의 p99"를 리셋 없이 뽑을 수 있게 된 셈이다.

예전에는 `structuredClone()`으로 복사하면 네이티브 히스토그램을 공유해 버려서 `export()`와 `importHistogram()`으로 직렬화했다가 다시 읽는 수밖에 없었다. 같은 릴리스에서 `monitorEventLoopDelay()` 해상도가 잘리던 문제도 고쳐졌다. `diff()`의 정확한 인자 형태는 PR 설명에 나오지 않아서 쓰기 전에 API 문서를 확인할 생각이다.

## 6. 권한 모델 보안 수정과 올리기 전 점검

`--permission`으로 권한 모델을 켠 상태에서 `new Socket(fd)`는 `--allow-net` 검사를 거치지 않았다. 파일 디스크립터에서 소켓을 만들면 네트워크 권한 없이도 통신할 수 있었다는 얘기다. 이번에 검사가 추가됐고 stdio와 IPC는 기존처럼 동작하도록 예외 처리됐다. 권한 모델로 서드파티 스크립트를 가둬 두고 있다면 이 수정 하나만으로도 올릴 이유가 된다.

올리기 전에 볼 것만 정리하면 이렇다.

- 설치할 버전은 26.11.0이 아니라 26.11.1
- `node:sqlite`를 쓰면 `DatabaseSync` 사용처와 deprecation 경고 여부
- `--permission`을 쓰는 서비스는 우선 업데이트
- 오래 도는 배치나 CI 스크립트에 `--process-timeout`을 붙일지
- 헤더를 직접 검증하는 코드가 try/catch로 감싸져 있다면 새 함수로 바꿀지

## 참고 자료

- [Node.js 26.11.0 (Current) 릴리스 노트](https://nodejs.org/en/blog/release/v26.11.0)
- [Node.js 26.11.1 (Current) 릴리스 노트](https://nodejs.org/en/blog/release/v26.11.1)
- [http: add isValidHeaderName() and isValidHeaderValue() (nodejs/node#66334)](https://github.com/nodejs/node/pull/66334)
- [src: add --process-timeout=N (nodejs/node#66138)](https://github.com/nodejs/node/pull/66138)
- [src: ensure Socket(fd) cannot bypass allow-net permission (nodejs/node#66117)](https://github.com/nodejs/node/pull/66117)
