---
title: "DynamoDB Streams AT_TIMESTAMP 지원: 스트림을 원하는 시점부터 다시 읽는다"
description: "10월 15일 DynamoDB Streams에 추가된 AT_TIMESTAMP 샤드 이터레이터를 AWS 공지, 개발자 가이드, API 레퍼런스 기준으로 정리했다. 동작 방식과 KCL 어댑터 설정, 운영할 때 주의할 점을 적었다."
date: 2026-10-18T09:40:00
update: 2026-10-18T09:40:00
tags:
  - AWS
  - Database
---

DynamoDB Streams에 `AT_TIMESTAMP` 샤드 이터레이터가 생겼다. 지금까지 스트림 소비자는 가장 오래 남아 있는 레코드(`TRIM_HORIZON`)부터 읽거나, 지금 이후의 레코드(`LATEST`)만 읽거나 둘 중 하나를 골라야 했다. 이제는 "오늘 새벽 3시 10분부터" 같은 시점을 지정해서 읽기 시작한다. 추가 요금은 없다.

> 스트림을 특정 시점부터 다시 읽으려면 어떻게 설정하고, 어떤 경우에 조심해야 하나?

> 이 글은 10월 15일 AWS What's New 공지, DynamoDB 개발자 가이드의 Streams 타임스탬프 페이지, DynamoDB Streams API 레퍼런스를 읽고 정리했다.

## 1. 무엇이 추가됐나

`GetShardIterator`의 `ShardIteratorType`에 `AT_TIMESTAMP`가 들어갔다. 이제 선택지는 다섯 개다.

| 이터레이터 타입         | 읽기 시작 위치                 |
| ----------------------- | ------------------------------ |
| `TRIM_HORIZON`          | 남아 있는 가장 오래된 레코드   |
| `LATEST`                | 이후 새로 쓰이는 레코드        |
| `AT_SEQUENCE_NUMBER`    | 지정한 시퀀스 번호부터         |
| `AFTER_SEQUENCE_NUMBER` | 지정한 시퀀스 번호 다음부터    |
| `AT_TIMESTAMP`          | 지정한 시각 이후 첫 레코드부터 |

기준은 레코드의 `ApproximateCreationDateTime`이다. 지정한 시각과 정확히 같은 레코드가 없으면 그다음 레코드부터 읽는다.

## 2. API로 직접 쓸 때

API 레퍼런스에 따르면 `AT_TIMESTAMP`를 쓸 때는 `Timestamp` 파라미터를 같이 넘긴다. 값은 밀리초 정밀도의 Unix epoch다.

```json
{
  "StreamArn": "arn:aws:dynamodb:ap-northeast-2:123456789012:table/orders/stream/2026-10-01T00:00:00.000",
  "ShardId": "shardId-00000001790000000000-abcdef12",
  "ShardIteratorType": "AT_TIMESTAMP",
  "Timestamp": 1791316726.48
}
```

경계 상황의 동작은 이렇게 정해져 있다.

- 지정한 시각이 trim horizon보다 오래되면 남아 있는 가장 오래된 레코드를 가리킨다. 오류는 나지 않는다.
- 미래 시각을 넣으면 `ValidationException`이 난다.

첫 번째가 조용히 동작한다는 점은 알아 둘 만하다. **보존 기간 24시간을 넘긴 레코드는 어떤 방법으로도 되살릴 수 없고**, 오래된 시각을 넣었다고 경고가 뜨지도 않는다.

## 3. KCL 어댑터로 쓸 때

대부분은 `GetShardIterator`를 직접 부르기보다 KCL(Kinesis Client Library)과 DynamoDB Streams Kinesis 어댑터로 소비한다. 어댑터 2.5.0 이상이 필요하고, IAM 권한은 기존과 같다. 개발자 가이드의 Java 예시는 이렇다.

```java
// 원하는 시각으로 시작 위치를 만든다
InitialPositionInStreamExtended initialPosition =
    InitialPositionInStreamExtended.newInitialPositionAtTimestamp(
        Date.from(Instant.ofEpochMilli(1790467200000L)));

// 스트림 트래커 생성
StreamTracker streamTracker = StreamsSchedulerFactory.createSingleStreamTracker(
    streamArn,
    initialPosition);

// 스케줄러가 이 시각 기준으로 샤드를 읽도록 등록
configsBuilder.streamTracker(streamTracker);
```

어댑터는 새 lease마다 `AT_TIMESTAMP`를 초기 위치로 잡고, lease별로 `GetShardIterator`를 불러 이터레이터를 받는다. 미래 시각은 초기화 단계에서 API 호출 없이 거부되고 처리가 시작되지 않는다.

## 4. 가장 걸리기 쉬운 부분: 기존 lease 테이블

개인적으로 이 기능에서 제일 조심해야 할 부분은 여기라고 본다. 이미 lease 테이블에 상태가 있는 애플리케이션에서 시작 시각을 바꾸거나 `AT_TIMESTAMP`, `TRIM_HORIZON`, `LATEST` 사이를 오가도 반영되지 않는다. 체크포인트가 저장된 샤드는 그 체크포인트부터 이어 읽기 때문이다. 가이드가 제시하는 방법은 두 가지다.

1. 모든 워커를 멈추고, lease 테이블을 지우고, 설정을 바꾼 뒤 다시 시작한다(권장).
2. 애플리케이션 이름을 바꿔서 새 lease 테이블을 만들게 한다.

어느 쪽이든 기존 체크포인트를 버리는 작업이라, 운영 중인 소비자에 적용할 때는 재처리 범위를 먼저 계산해 두는 게 맞다.

## 5. 어디에 쓰면 좋나

공지에 나온 활용 예는 이렇다.

- 소비자가 중단됐다가 다시 붙을 때 전체 재처리 없이 중단 시점부터 이어 읽기
- 디버깅이나 감사를 위해 과거 특정 시점부터 다시 읽기
- 밀린 백로그를 건너뛰고 최근 시점부터 읽기
- PITR(point-in-time recovery) export로 복원한 뒤, export 시각부터 스트림을 읽어 동기화하기

마지막 경우가 특히 쓸모 있어 보인다. 이제 export 시각을 그대로 넣으면 된다. 물론 export부터 적재까지 24시간 안에 끝나야 한다.

점검할 것만 추리면 이렇다.

- 어댑터 버전이 2.5.0 이상인지
- 재처리하려는 시점이 24시간 보존 기간 안인지
- 시작 위치를 바꿀 때 lease 테이블을 어떻게 처리할지
- 소비 로직이 같은 레코드를 두 번 받아도 안전한지(멱등성)

공지에는 Lambda 이벤트 소스 매핑 지원 여부가 나오지 않는다. Lambda로 스트림을 소비하고 있다면 Lambda 쪽 문서를 따로 확인해야 한다.

## 참고 자료

- [Amazon DynamoDB Streams now supports timestamp-based stream processing (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/10/amazon-dynamodb-streams-timestamp-processing)
- [DynamoDB Streams 타임스탬프 기반 처리 (개발자 가이드)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.Timestamp.html)
- [GetShardIterator (DynamoDB Streams API Reference)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_streams_GetShardIterator.html)
