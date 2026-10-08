---
title: "Aurora PostgreSQL에서 Iceberg·Parquet 직접 조회: 데이터 레이크를 위한 ETL이 하나 줄어든다"
description: "Aurora PostgreSQL 17.11, 18.6부터 aurora_analytics 확장으로 S3의 Iceberg·Parquet 데이터를 외부 테이블로 바로 조회하게 됐다. 설정 방법과 쿼리 예시, 운영할 때 볼 부분을 공식 발표 기준으로 정리했다."
date: 2026-10-08T08:55:00
update: 2026-10-08T08:55:00
tags:
  - AWS
  - Database
  - PostgreSQL
---

AWS가 9월 30일 Aurora PostgreSQL에서 S3에 있는 Apache Iceberg, Parquet 데이터를 직접 조회하는 기능을 발표했다. 운영 DB에 있는 최근 데이터와 데이터 레이크에 쌓인 과거 데이터를 SQL 한 번으로 같이 읽는다. 지금까지는 레이크 데이터를 서비스에서 보여 주려면 배치로 운영 DB에 다시 복사하는 리버스 ETL을 따로 돌리는 경우가 많았는데, 그 파이프라인 일부가 필요 없어지는 변화다.

> 레이크에 있는 데이터를 서비스 DB로 옮기지 않고, 애플리케이션이 쓰던 PostgreSQL 쿼리 그대로 읽을 수 있을까?

> 이 글은 AWS News Blog 발표 글을 기준으로 정리했다. 아직 상세 문서에 나오지 않은 동작은 쓰지 않았고, 확인이 필요한 부분은 따로 적었다.

## 1. 무엇이 추가됐나

새로 생긴 건 `aurora_analytics`라는 확장이다. 이 확장을 켜면 S3의 Parquet 파일이나 Iceberg 테이블을 PostgreSQL 외부 테이블(foreign table)로 만든다. 발표 글에 따르면 Aurora 안에 DuckDB 엔진이 내장돼 있고, 쿼리 처리는 Aurora 안에서 끝나서 별도 네트워크 홉이 생기지 않는다.

지원 버전과 데이터 소스는 다음과 같다.

| 구분      | 내용                                                      |
| --------- | --------------------------------------------------------- |
| 엔진 버전 | Aurora PostgreSQL 17.11 이상, 18.6 이상                   |
| 카탈로그  | AWS Glue Data Catalog로 관리하는 Iceberg 테이블           |
| 저장 위치 | Amazon S3의 Parquet·Iceberg, S3 Tables                    |
| 외부 연동 | Iceberg REST Catalog 호환 카탈로그 (Glue 페더레이션 경유) |
| 비용      | 기능 자체는 무료, Aurora 컴퓨팅과 S3 요청 비용만 발생     |
| 리전      | 모든 상용 리전과 GovCloud (US)                            |

버전 조건이 꽤 최신이라 17.11 아래 마이너 버전을 쓰고 있다면 업그레이드부터 해야 한다.

## 2. 설정은 세 단계

발표 글에 나온 순서를 그대로 옮기면 이렇다.

1. Aurora PostgreSQL 클러스터를 만든다(또는 지원 버전으로 올린다).
2. `AuroraAnalytics` 기능으로 IAM 역할을 클러스터에 연결한다. 이 역할이 S3와 Glue Data Catalog 접근 권한을 준다.
3. DB에서 확장을 켠다.

```sql
CREATE EXTENSION aurora_analytics;
```

그다음 외부 테이블을 만든다. Parquet 파일 하나를 붙이는 예시는 이렇다.

```sql
CREATE FOREIGN TABLE transaction_history ()
SERVER aurora_analytics_server
OPTIONS (
    location 's3://<my-bucket>/finance/transaction_history.parquet',
    format 'parquet'
);
```

컬럼 목록이 비어 있는 게 의도된 부분이다. Parquet 메타데이터에서 스키마를 읽어 오기 때문에 컬럼을 직접 적지 않아도 된다. 테이블이 많으면 `IMPORT FOREIGN SCHEMA` 한 번으로 Glue 데이터베이스에 있는 Iceberg·Parquet 테이블을 전부 외부 테이블로 만든다고 한다. 다만 발표 글에는 이 문장의 정확한 문법이 나오지 않아서, 실제로 쓸 때는 Aurora 사용자 가이드를 확인하는 게 맞겠다.

## 3. 운영 데이터와 레이크 데이터를 한 쿼리로

발표 글의 예시가 이 기능을 왜 만들었는지 잘 보여 준다. 최근 7일 거래는 Aurora 테이블에, 5년치 이력은 S3 Parquet에 있는 상황이다.

```sql
SELECT merchant, category, amount, transaction_date, 'recent' AS source
FROM recent_transactions
WHERE customer_id = 'C-1001'
UNION ALL
SELECT merchant, category, amount, transaction_date, 'historical' AS source
FROM transaction_history
WHERE customer_id = 'C-1001'
  AND transaction_date >= CURRENT_DATE - INTERVAL '5 years'
ORDER BY transaction_date DESC
LIMIT 15;
```

애플리케이션 입장에서는 그냥 테이블 두 개를 `UNION ALL` 한 쿼리다. 고객 거래 내역 화면처럼 "최근 것은 빠르게, 오래된 것도 가끔은 보여 줘야 하는" API에서 지금까지 따로 두던 아카이브 조회 경로를 하나로 합치게 된다. 발표 글에는 커밋되지 않은 운영 쪽 쓰기까지 같은 쿼리에서 보인다는 설명도 있다.

## 4. 자주 읽는 데이터는 Aurora로 가져온다

외부 테이블은 매번 S3를 읽는다. 자주 조회하는 범위라면 Aurora 테이블로 옮겨 두는 편이 낫다. 문법은 평소 쓰던 PostgreSQL 그대로다.

| 방법                     | 쓰임새                         |
| ------------------------ | ------------------------------ |
| `CREATE TABLE AS SELECT` | 레이크 데이터로 새 테이블 생성 |
| `INSERT INTO ... SELECT` | 기존 테이블에 범위 단위로 적재 |
| `MERGE INTO`             | 변경분을 기존 테이블에 반영    |

여기서 하나 걸리는 게 인스턴스 역할이다. 이런 적재 명령은 Aurora에 쓰기를 하니까 writer 인스턴스에서만 돌아간다. 반대로 외부 테이블 조회는 read replica를 포함한 아무 인스턴스에서나 된다. 분석성 스캔을 replica로 보내면 writer 부하를 건드리지 않고 레이크를 읽는다는 뜻이고, 개인적으로는 이 부분이 실무에서 제일 쓸모 있어 보였다.

## 5. 성능과 비용은 어디서 보나

발표 글에서 언급한 최적화는 세 가지다. 필터 조건을 스캔 단계로 내려보내는 predicate pushdown, 필요한 컬럼만 읽는 column pruning, 그리고 자주 읽는 데이터를 인스턴스에 캐시하는 것이다. 그래서 `WHERE` 조건 없이 큰 Parquet을 통째로 읽는 쿼리는 여전히 비싸다.

쿼리별로 얼마나 읽었는지는 함수로 확인한다.

```sql
SELECT * FROM aurora_analytics_stat_statements();
```

스캔한 행 수, S3에서 읽은 바이트, 캐시 적중 같은 지표가 나온다고 한다. 기능 자체는 추가 요금이 없지만 S3 요청 비용과 Aurora 컴퓨팅 사용량은 그대로 붙기 때문에, 도입 초기에 이 지표로 무거운 쿼리를 먼저 찾아 두는 게 좋겠다.

## 6. 도입 전에 확인할 것

- 클러스터 버전이 17.11 또는 18.6 이상인지
- `AuroraAnalytics` IAM 역할이 읽어야 할 버킷과 Glue 데이터베이스로만 좁혀져 있는지
- 외부 테이블 조회가 replica로 가도록 커넥션 라우팅이 나뉘어 있는지
- 자주 읽는 범위는 `INSERT INTO ... SELECT`로 옮길지, 외부 테이블로 둘지
- 기존 리버스 ETL 배치 중 이 기능으로 없앨 수 있는 게 있는지

레이크와 서비스 DB 사이를 잇던 배치가 많은 팀일수록 얻는 게 크다. 반대로 레이크 데이터를 거의 안 읽는 서비스라면 굳이 버전을 올려 가며 쓸 이유는 아직 없어 보인다.

## 참고 자료

- [Amazon Aurora PostgreSQL now supports direct querying of Apache Iceberg and Parquet data in your data lake (AWS News Blog)](https://aws.amazon.com/blogs/aws/amazon-aurora-postgresql-now-supports-direct-querying-of-apache-iceberg-and-parquet-data-in-your-data-lake/)
- [AWS Weekly Roundup, October 5, 2026 (AWS News Blog)](https://aws.amazon.com/blogs/aws/aws-weekly-roundup-amazon-bedrock-managed-agents-powered-by-openai-q3-service-availability-updates-kiro-workflows-and-more-october-5-2026/)
- [Amazon Aurora PostgreSQL 사용자 가이드](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/)
