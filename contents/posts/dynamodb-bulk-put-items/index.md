---
title: "DynamoDB 벌크 put 정식 출시: S3 데이터를 기존 테이블에 적재할 때 BatchWriteItem과 다른 점"
description: "DynamoDB가 S3 파일을 기존 테이블에 비동기로 적재하는 StartBulkPutItems를 내놨다. 테이블 용량을 쓰지 않는 대신 원자성은 없고, 실패는 S3 리포트로 남는다. 공식 문서 기준으로 정리했다."
date: 2026-11-08T09:40:00
update: 2026-11-08T09:40:00
tags:
  - AWS
  - Database
---

11월 5일 **DynamoDB 벌크 put(bulk put items)이 정식 출시됐다**. S3에 올려 둔 파일을 이미 운영 중인 테이블에 대량으로 적재하는 비동기 작업이다. 테이블의 읽기·쓰기 용량을 쓰지 않고 별도 경로로 쓴다는 점이 `BatchWriteItem` 반복 호출과 가장 다르다. 대신 실패 처리 방식도 완전히 다르다.

> 기존 테이블에 대량 적재할 때 벌크 put으로 바꾸면 무엇이 편해지고, 무엇을 새로 챙겨야 하는가?

> 이 글은 AWS What's New 공지와 DynamoDB 개발자 가이드의 벌크 put 문서, `StartBulkPutItems` API 레퍼런스를 읽고 정리했다. 요금 단가는 확인하지 않았다.

## 1. 어떤 작업인가

API는 네 개다.

| 작업                    | 역할                  |
| ----------------------- | --------------------- |
| `StartBulkPutItems`     | S3 입력으로 적재 시작 |
| `DescribeBulkOperation` | 진행 상태 조회        |
| `ListBulkOperations`    | 작업 목록 조회        |
| `CancelBulkOperation`   | 작업 취소             |

요청에는 테이블 이름, 입력 S3 설정, 출력 S3 설정이 필수로 들어간다. 입력 형식은 `DYNAMODB_JSON`이나 `ION`이고, 압축은 `GZIP`, `ZSTD`, `NONE` 중 하나다. 출력 설정이 필수라는 점이 눈에 띈다. 실패 내역을 받을 S3 위치를 반드시 정해야 작업이 시작된다.

CLI는 `aws dynamodb start-bulk-put-items`로 시작하고 아래처럼 진행을 본다.

```bash
aws dynamodb list-bulk-operations
aws dynamodb describe-bulk-operation --bulk-operation-arn <BULK_OPERATION_ARN>
```

작업 상태는 `IN_PROGRESS`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `CANCELLING`, `CANCELLED`, `FAILED`로 나뉜다.

## 2. BatchWriteItem과 무엇이 다른가

문서에 두 API를 나란히 비교한 표는 없다. 문서 내용을 바탕으로 정리하면 이렇다.

| 항목          | `BatchWriteItem`   | 벌크 put       |
| ------------- | ------------------ | -------------- |
| 입력          | API 요청 묶음      | S3 파일        |
| 실행 방식     | 동기 호출          | 비동기 작업    |
| 테이블 용량   | 쓰기 용량 소비     | 소비하지 않음  |
| 실패 항목     | 응답의 미처리 항목 | S3 리포트 파일 |
| 글로벌 테이블 | 사용 가능          | 지원 안 함     |

**원자성은 없다.** 항목은 하나씩 쓰이고, 작업을 취소해도 이미 쓴 항목은 되돌아가지 않는다. 실패한 항목은 응답으로 돌려받는 게 아니라 S3에 리포트로 남는다. 리포트 종류는 검증 실패를 담는 `ERROR`와 조건 불일치를 담는 `CONDITION_CHECK_FAILURE`다. 입력 파일마다 처리 상태(`FULLY_PROCESSED`, `PARTIALLY_PROCESSED`, `NOT_PROCESSED` 등)를 적은 매니페스트 파일도 함께 나온다.

개인적으로는 용량을 쓰지 않는다는 점이 가장 컸다. 문서 표현으로는 테이블의 읽기·쓰기 용량을 전혀 소비하지 않는다. 대신 이 쓰기는 `ConsumedWriteCapacityUnits`나 Contributor Insights에 잡히지 않는다. 모니터링 대시보드만 보고 있으면 적재가 진행 중인지 모를 수 있다.

## 3. 조건식과 중복 쓰기

항목별 조건식을 지원하고 문법은 `PutItem`과 같다. 문서 예시는 신규 삽입만 허용하는 `attribute_not_exists(pk)`와 버전 속성을 비교하는 방식이다. 조건을 주지 않으면 같은 키의 기존 항목을 덮어쓴다.

조건식은 사실상 필수로 보인다. 문서가 짚은 고려 사항 중에 내부 장애 조치 이후 **중복 쓰기가 일어날 수 있다**는 항목이 있다. 그래서 더 새로운 데이터를 덮어쓰지 않도록 버전 조건을 걸라고 권한다.

그 밖의 제약도 적어 둔다.

- 쓰기가 DAX를 거치지 않는다
- DynamoDB Streams 소비자는 적재 속도 그대로 레코드를 받는다
- 인덱스 생성, 글로벌 테이블 전환, 백업 복원 중에는 시작할 수 없다
- 작업 중 S3 입력 객체를 바꾸면 안 된다
- 교차 계정 호출은 막혀 있다

## 4. 한도와 비용

| 항목                  | Standard | Accelerated |
| --------------------- | -------- | ----------- |
| 작업당 총 입력        | 100GB    | 1TB         |
| 계정·리전당 동시 작업 | 5개      | 5개         |
| 테이블당 활성 작업    | 1개      | 1개         |

입력 객체는 작업당 5만 개, 객체 하나는 5GB까지다. `MaxWriteRequestUnits`로 적재 속도 상한을 둘 수 있고 최솟값은 1,024다. Accelerated는 서울 리전에서도 쓸 수 있다. 벡터 인덱스가 있는 테이블은 Accelerated를 쓸 수 없다.

요금은 쓴 바이트 기준이고, GSI와 LSI 쓰기는 따로 계량된다. 검증에서 거부된 항목은 과금되지 않지만, 테이블까지 가서 조건 검사에 실패한 항목은 과금된다. 리포트 파일은 S3 요금이 붙는다. 등급별 단가는 요금 페이지를 따로 봐야 한다.

### 점검 목록

- 대상 테이블이 글로벌 테이블이 아닌지 확인한다
- 출력용 S3 버킷과 리포트 처리 방법을 먼저 정한다
- 덮어쓰기를 막는 조건식(키 존재 여부나 버전)을 넣는다
- Streams 소비자와 Lambda 동시성이 적재 속도를 버티는지 본다
- 쓰기 용량 지표에 안 잡히므로 `DescribeBulkOperation`으로 진행을 추적한다
- IAM에 벌크 작업 권한 다섯 개를 추가한다

## 참고 자료

- [Amazon DynamoDB now supports bulk put items](https://aws.amazon.com/about-aws/whats-new/2026/11/amazon-dynamodb-now-supports-bulk-put-items/)
- [How bulk put items works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BulkPutItems.HowItWorks.html)
- [Bulk put items considerations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BulkPutItems.Considerations.html)
- [StartBulkPutItems API reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_StartBulkPutItems.html)
