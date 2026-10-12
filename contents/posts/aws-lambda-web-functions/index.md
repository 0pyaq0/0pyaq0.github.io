---
title: "AWS Lambda Web Functions 출시: Express 서버를 그대로 Lambda에 올린다"
description: "10월 12일 발표된 Lambda Web Functions를 AWS 발표와 개발자 가이드 기준으로 정리했다. 기존 Lambda와 무엇이 다른지, 동시성과 과금 방식, 배포 명령, 운영할 때 걸리는 제약을 다룬다."
date: 2026-10-13T09:05:00
update: 2026-10-13T09:05:00
tags:
  - AWS
  - Serverless
  - Node.js
---

AWS가 10월 12일 Lambda Web Functions를 발표했다. 포트를 열고 HTTP 요청을 받는 평범한 웹 서버 코드를 어댑터 없이 Lambda에 올리는 새 함수 형태다. 실행 환경 하나가 요청을 여러 개 동시에 처리하고, 과금도 벽시계 시간이 아니라 실제로 CPU를 쓴 시간 기준이다. DB 응답을 기다리는 시간이 대부분인 API 서버라면 지금까지 Lambda에 올릴 때 손해 보던 부분이 거의 사라진다. 기존 Lambda 함수는 이번에 Lambda Event Functions라는 이름으로 바뀌었는데, 이름만 바뀐 것이고 코드나 재배포는 필요 없다.

> Web Functions는 기존 Lambda와 무엇이 다르고, 어떤 API 서버를 옮길 만한가?

> 이 글은 AWS What's New 공지, AWS News Blog 발표 글, Lambda 개발자 가이드를 읽고 정리했다. 출시 직후라 문서 일부 페이지는 아직 내용이 비어 있었고, 확인하지 못한 값은 쓰지 않았다.

## 1. Event Functions와 무엇이 다른가

발표 글은 Lambda의 형태를 Event Functions, Web Functions, MicroVMs 세 가지로 나눈다. 셋 다 Firecracker로 격리된다. 백엔드 개발자에게 의미 있는 비교는 앞의 두 개다.

| 구분       | Event Functions           | Web Functions                       |
| ---------- | ------------------------- | ----------------------------------- |
| 코드 형태  | 이벤트 핸들러 함수        | 포트를 여는 HTTP 서버               |
| 동시 처리  | 환경당 요청 1개           | 환경당 여러 요청 (최대 128)         |
| 과금       | 벽시계 시간               | 활성 CPU 시간과 환경 유지 중 메모리 |
| 잘 맞는 곳 | 큐 소비, 파일 업로드 처리 | 웹 앱, API, SSR, I/O 위주 HTTP 처리 |

지금까지 Express 앱을 Lambda에 올리려면 API Gateway 이벤트를 HTTP 요청으로 바꿔 주는 어댑터를 끼우는 경우가 많았다. Web Functions에서는 그냥 `app.listen()`을 한다. 이벤트 처리는 여전히 Event Functions 몫이라 SQS 소비자 같은 코드는 그대로 두면 된다.

## 2. 코드는 이렇게 바뀐다

서버는 Lambda가 `AWS_LAMBDA_HTTP_ENDPOINT` 환경 변수로 알려 주는 호스트와 포트에서 요청을 받는다. 발표 글 예시를 Express 앱 형태로 옮기면 이렇다.

```javascript
const express = require("express")
const app = express()

app.get("/", (req, res) => {
  res.json({ message: "Hello from Lambda Web Functions!" })
})

const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(":")
app.listen(port, host, () => {
  console.log(`Server running on port ${port}`)
})
```

로컬에서는 환경 변수만 넣어서 돌린다.

```bash
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3000 node index.js
```

발표 글은 Express, Hono, Fastify, Next.js를 예로 든다. 다만 **출시 시점 런타임은 Node.js 24(`nodejs24.x`) Arm64 하나뿐이다.** 개발자 가이드에도 Java, Python, .NET은 지원하지 않는다고 적혀 있어서 Spring Boot나 FastAPI 서버는 아직 대상이 아니다.

## 3. 배포와 트래픽 전환

새 CLI 명령 `aws lambda-web`이 생겼다. 배포는 한 줄이다.

```bash
aws lambda-web deploy --name my-web-app --code ./my-app
```

소스를 묶어서 Web Function을 만들고, 첫 revision을 발행하고, endpoint를 붙여 HTTPS URL을 돌려준다. 같은 명령을 다시 실행하면 새 revision이 올라가고 endpoint가 그쪽을 가리킨다.

- revision: 코드와 설정의 변경 불가능한 스냅샷
- endpoint: 요청을 revision 하나 또는 둘로 보내는 HTTPS URL

endpoint가 revision 두 개에 가중치를 나눌 수 있어서 90:10 같은 카나리 배포가 기본으로 된다. 발표 글에는 `update-web-function-endpoint` 명령에 `--revision-weights`를 주는 예시가 나온다.

여러 리전에 동시에 올리는 것도 옵션 하나다.

```bash
aws lambda-web deploy --name my-web-app --code ./my-app \
    --regions us-east-1,eu-west-1,ap-northeast-1
```

이렇게 하면 `<domain-id>.lambda-web.global.on.aws` 형태의 글로벌 URL로 들어온 요청을 지연 시간이 가장 짧은 리전으로 보낸다. 발표 글 표현으로는 best-effort 기준이다. 출시 리전은 버지니아, 오하이오, 오레곤, 도쿄, 아일랜드 다섯 곳이고 서울은 아직 없다.

## 4. 동시성과 과금에서 볼 부분

스케일링 설정은 세 가지다.

| 설정                           | 위치     | 범위와 기본값           |
| ------------------------------ | -------- | ----------------------- |
| `maxConcurrencyPerEnvironment` | revision | 1~128, 기본 64          |
| `maxEnvironments`              | endpoint | 2~10,000, 기본 없음     |
| `rateLimit`                    | endpoint | 0~10,000 RPS, 기본 없음 |

최대 동시 요청은 대략 `maxEnvironments × maxConcurrencyPerEnvironment`다. 계정 단위로는 리전당 vCPU 2,000개 쿼터가 있고 환경 하나가 vCPU 2개를 쓰니, 계정 전체에서 리전당 환경은 최대 1,000개다. 한도에 걸리면 큐에 쌓지 않고 바로 429를 돌려준다.

개인적으로 더 신경 쓰인 건 두 가지다.

- **최소 환경 설정이 없다.** 트래픽이 없으면 환경이 0까지 줄고, 다음 요청은 콜드 스타트다. 새벽에 트래픽이 끊기는 서비스라면 아침 첫 요청이 느릴 수 있다.
- 과금 항목은 요청 수, 활성 CPU 시간, 환경이 살아 있는 동안의 메모리(유휴 시간 포함), 데이터 전송이다. CPU는 기다리는 시간이 빠지지만 메모리는 환경이 떠 있는 내내 나간다.

동시성 64가 기본이라는 것도 코드 입장에서는 큰 변화다. Event Functions에서는 환경 하나에 요청 하나라 전역 변수를 막 써도 문제가 안 됐는데, 이제는 일반 Node 서버처럼 요청 간 상태 공유를 조심해야 한다. DB 커넥션 풀 크기도 환경당 동시 요청 수에 맞춰 다시 잡아야 한다.

## 5. 옮기기 전에 확인할 것

HTTP 처리 문서에 운영에서 걸릴 만한 제약이 꽤 있다.

- HTTP/1.1만 받는다. HTTP/1.0 요청은 505
- 요청 라인과 헤더 합계 128 KiB를 넘으면 431
- `Upgrade`, `Connection` 같은 연결 단위 헤더는 제거된다
- `X-Forwarded-For`는 마지막 값만 Lambda가 붙인 값이고, `X-Forwarded-Host`는 검증 없이 넘어온다
- 인증은 endpoint마다 IAM 또는 애플리케이션 자체 인증 중 하나
- 커스텀 도메인과 WAF는 CloudFront를 앞에 두는 방식. OAC를 붙이면 CloudFront를 거친 요청만 받는다
- 환경이 줄어들 때 `SIGTERM`을 보내니 graceful shutdown 처리를 넣어 둔다

요청 타임아웃과 페이로드 크기 제한은 확인한 문서에 아직 나오지 않았다. 대용량 업로드나 긴 스트리밍 응답이 있는 API라면 이 값부터 확인하고 옮기는 게 맞겠다. 반대로 Node 기반 BFF나 웹훅 수신 서버처럼 가볍고 I/O 대기가 많은 서비스는 ECS에 상시로 띄워 두던 것보다 비용 구조가 나아질 가능성이 커 보인다.

## 참고 자료

- [AWS Lambda announces Lambda Web Functions (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/)
- [Announcing AWS Lambda Web Functions (AWS News Blog)](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/)
- [Lambda Web Functions 개발자 가이드](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
- [Web Functions 스케일링 동작](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)
- [Web Functions HTTP 요청과 응답](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)
