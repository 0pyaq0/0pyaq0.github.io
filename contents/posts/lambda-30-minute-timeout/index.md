---
title: "Lambda 타임아웃 30분: 15분 제한은 풀렸지만 호출하는 쪽은 그대로다"
description: "AWS Lambda의 온디맨드 Event Functions 최대 타임아웃이 15분에서 30분으로 늘었다. 호출 방식별로 실제로 얼마나 기다려 주는지, SQS 연동에서 같이 바꿔야 할 값, 설정 방법을 AWS 공지와 Lambda 개발자 가이드 기준으로 정리했다."
date: 2026-11-28T09:40:00
update: 2026-11-28T09:40:00
tags:
  - AWS
  - DevOps
---

Lambda의 15분 제한은 오래된 설계 제약이었다. 배치 하나가 15분을 넘을 것 같으면 작업을 쪼개거나 Step Functions로 나누거나 아예 ECS로 옮겼다. 11월 19일 AWS 공지로 온디맨드로 실행되는 Event Functions의 최대 타임아웃이 **30분(1,800초)** 으로 두 배가 됐다. 동기, 비동기, 이벤트 소스 매핑(ESM) 호출 모두에 적용되고, 모든 상용 리전에서 쓸 수 있다. 다만 함수가 30분을 돌 수 있다고 해서 앞단의 API Gateway가 30분을 기다려 주지는 않는다. 업그레이드라기보다 설정 범위가 넓어진 것이라 어디서 쓸 수 있는지를 따로 봐야 한다.

> 타임아웃을 30분으로 올리면 어떤 호출 경로에서 실제로 효과가 있고, 같이 바꿔야 할 값은 무엇일까?

> 이 글은 AWS What's New 공지와 Lambda 개발자 가이드의 타임아웃 설정 페이지, 다른 서비스에서 Lambda를 호출하는 경우를 다룬 페이지를 읽고 정리했다.

## 1. 바뀐 범위

공지에서 말하는 Event Functions는 기본적으로 온디맨드로 실행되고 Lambda가 트래픽에 맞춰 자동으로 확장하는 함수다. 꾸준한 트래픽용으로 Lambda Managed Instances에서 돌리는 방법도 있는데, 그쪽은 제한이 다르다.

| 실행 방식         | 호출 유형         | 최대 타임아웃    |
| ----------------- | ----------------- | ---------------- |
| 온디맨드          | 동기, 비동기, ESM | 30분 (이전 15분) |
| Managed Instances | 동기              | 30분             |
| Managed Instances | 비동기, ESM       | 90분             |

durable functions를 쓰거나 Step Functions Standard 워크플로에서 호출할 때도 30분이 적용된다. 기본값은 여전히 3초이고, 1초 단위로 1,800초까지 올릴 수 있다. 요금은 기존 Lambda 요금 그대로다.

## 2. 호출하는 쪽이 먼저 끊는다

개인적으로 가장 걸렸던 부분은 여기다. 개발자 가이드의 호출 서비스 표를 보면 동기 호출자는 각자 기다리는 시간이 정해져 있다.

| 호출자                   | 기다리는 시간            |
| ------------------------ | ------------------------ |
| API Gateway REST API     | 기본 29초(통합 타임아웃) |
| API Gateway HTTP API     | 최대 30초                |
| Cognito 사용자 풀 트리거 | 5초                      |
| Step Functions, 함수 URL | 함수가 반환할 때까지     |

호출자가 먼저 기다림을 멈춰도 함수는 반환하거나 타임아웃에 걸릴 때까지 계속 돌고, 그 시간만큼 과금된다. API Gateway 뒤에 있는 함수의 타임아웃을 30분으로 올려도 사용자는 30초 안에 에러를 받는다. 그 뒤로 함수가 계속 돌면 비용만 쌓인다. 오히려 API 뒤 함수는 타임아웃을 호출자 대기 시간에 맞춰 짧게 두는 편이 낫다.

정리하면 30분이 실제로 쓸모 있는 경로는 이렇다.

- 비동기 호출(S3, SNS, EventBridge 등에서 이벤트로 호출)
- SQS 같은 이벤트 소스 매핑
- Step Functions나 함수 URL처럼 끝까지 기다려 주는 동기 호출

## 3. SQS와 연결된 함수라면 순서가 있다

ESM으로 SQS를 읽는 함수는 타임아웃만 올리면 안 된다. 개발자 가이드는 함수 타임아웃을 올리기 전에 큐의 가시성 타임아웃(visibility timeout)을 먼저 늘리라고 적고 있다. 함수가 메시지를 처리하는 동안 가시성 타임아웃이 끝나면 같은 메시지가 다른 호출로 다시 전달될 수 있기 때문이다. 문서에 정확한 배수는 나와 있지 않아서, 적어도 함수 타임아웃보다는 길게 잡는다는 정도로 기억해 두면 된다.

```bash
# 1) 큐의 가시성 타임아웃을 먼저 늘린다 (예: 35분)
aws sqs set-queue-attributes \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/123456789012/report-jobs \
  --attributes VisibilityTimeout=2100

# 2) 그다음 함수 타임아웃을 30분으로 올린다
aws lambda update-function-configuration \
  --function-name report-worker \
  --timeout 1800
```

순서를 거꾸로 하면 잠깐 사이에 중복 처리가 생길 수 있다. 멱등하게 짜여 있지 않은 작업이라면 특히 그렇다.

## 4. 설정 방법

콘솔에서는 함수의 Configuration 탭, General configuration에서 Timeout을 1~1,800초 사이로 바꾼다. CLI는 위 예시처럼 `--timeout`을 쓴다. SAM이라면 템플릿의 `Timeout` 값을 바꾸고 배포한다.

```yaml
Resources:
  ReportWorker:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.handler
      Runtime: python3.13
      Timeout: 1800
```

공지는 SDK, CloudFormation, CDK로도 설정할 수 있다고 적고 있다. 지금 쓰는 IaC 도구의 유효성 검사가 900을 상한으로 두고 있지는 않은지도 한 번 볼 만하다. 도구 버전에 따라 새 범위를 아직 반영하지 않았을 수 있다.

### 점검 목록

- [ ] 15분 때문에 쪼개 둔 작업 중 비동기나 ESM 경로로 도는 것이 있는가
- [ ] API Gateway 뒤 함수의 타임아웃이 호출자 대기 시간보다 쓸데없이 길지 않은가
- [ ] SQS 연결 함수는 가시성 타임아웃을 먼저 늘렸는가
- [ ] 긴 실행이 늘어날 때 비용 알람 기준을 다시 잡았는가
- [ ] IaC 도구가 1,800초를 허용하는 버전인가

## 참고 자료

- [AWS Lambda now supports a 30-minute timeout for on-demand Event Functions](https://aws.amazon.com/about-aws/whats-new/2026/11/aws-lambda-30-minute-ondemand-event-functions/)
- [Configure Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)
- [Invoking Lambda with events from other AWS services](https://docs.aws.amazon.com/lambda/latest/dg/lambda-services.html)
