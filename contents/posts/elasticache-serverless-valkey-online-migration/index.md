---
title: "ElastiCache Serverless for Valkey 온라인 마이그레이션: EC2 위 Redis를 끊김 없이 옮기는 절차"
description: "10월 20일 ElastiCache Serverless for Valkey가 EC2에서 직접 운영하던 Valkey, Redis OSS를 다운타임 없이 옮기는 온라인 마이그레이션을 지원하기 시작했다. 지원 범위, 단계별 동작, 막히기 쉬운 제약을 정리했다."
date: 2026-10-21T09:40:00
update: 2026-10-21T09:40:00
tags:
  - AWS
  - Database
---

EC2에 직접 띄워 둔 Redis OSS나 Valkey 클러스터를 ElastiCache Serverless for Valkey로 옮길 때, 이제 서비스를 멈추지 않고 넘어갈 수 있다. AWS가 10월 20일 온라인 마이그레이션 지원을 발표했다. 서드파티 복제 도구도 필요 없다. 이번 기능은 마이그레이션 엔드포인트 하나를 두고 그 뒤에서 원본과 대상을 바꿔 끼우는 방식이다.

> 직접 운영하던 캐시를 Serverless로 옮길 때 어떤 순서로 진행되고, 어디서 막히나?

> 이 글은 AWS What's New 공지와 ElastiCache 개발자 가이드의 온라인 마이그레이션 개요 페이지를 확인해 정리했다. 세부 CLI 절차는 가이드 하위 페이지에 따로 있다.

## 1. 무엇을 어디로 옮길 수 있나

여기서 말하는 다운타임 없음은 마이그레이션 중 클라이언트에 오류가 하나도 돌아가지 않는다는 뜻이고, ElastiCache SLA와 같은 방식으로 잰다.

| 구분 | 지원 범위                                                |
| ---- | -------------------------------------------------------- |
| 원본 | EC2 위 클러스터 모드 Redis OSS `4.0`~`7.2`               |
| 원본 | EC2 위 클러스터 모드 Valkey `7.2`~`8.1`                  |
| 대상 | 미리 만든 빈 Serverless 캐시, Valkey `7.2`, `8.1`, `9.0` |

원본 버전은 대상 버전보다 높을 수 없다. ElastiCache 관리형 캐시나 MemoryDB는 원본이 될 수 없다.

모든 상용 리전과 중국, GovCloud(US) 리전에서 쓸 수 있다. 계정당 첫 prepare 시점부터 180일은 마이그레이션 사용료가 없고, 그 뒤엔 마이그레이션이 도는 동안 마이그레이션 노드 시간당 과금된다. Serverless 캐시 자체 요금은 무료 기간에도 따로 나온다.

## 2. 단계별로 무슨 일이 일어나나

1. Prepare: 원본이 요건에 맞는지 검사하고, 원본을 읽을 인프라를 띄우고, 마이그레이션 엔드포인트를 돌려준다. 요건이 안 맞으면 이 단계가 실패하고 캐시는 `available`로 돌아간다.
2. 애플리케이션 전환: 애플리케이션이 마이그레이션 엔드포인트를 바라보게 바꾸고 트래픽이 그쪽으로 흐르는지 확인한다.
3. `StartMigration`: 원본에서 대상으로 복제를 시작한다. 애플리케이션 쓰기도 따라간다.
4. `CompleteMigration`: 다음으로 완전히 동기화된 시점에 엔드포인트가 대상을 바라보게 바뀐다.

**2단계는 ElastiCache가 대신 확인해 주지 않는다.** 애플리케이션이 실제로 엔드포인트를 쓰고 있는지 알 방법이 없어서 사람이 챙겨야 한다. 개인적으로는 여기가 가장 놓치기 쉬워 보였다. 일부 인스턴스가 옛 원본 주소를 그대로 들고 있으면, 컷오버 이후 그 인스턴스만 원본에 쓰게 된다.

마이그레이션 엔드포인트는 Serverless 캐시의 표준 엔드포인트와 같은 주소다. 그래서 2단계에서 한 번 바꿔 두면 컷오버 뒤에 연결 문자열을 다시 손댈 필요가 없다.

컷오버는 기본이 수동이다. 콘솔의 Start migration 화면에서 Cutover mode를 자동으로 고르면 동기화가 맞는 시점에 알아서 넘어간다. 응답의 `CutoverMode` 필드는 자동을 골랐는지를 보여 줄 뿐, 컷오버가 진행 중이라는 뜻은 아니다.

## 3. 상태 확인과 되돌리기

진행 상태는 캐시의 `Migration` 객체에 담긴다.

```bash
aws elasticache describe-serverless-caches \
  --serverless-cache-name my-cache
```

| 상태              | 의미                                          |
| ----------------- | --------------------------------------------- |
| `preparing`       | 원본 검사, 인프라 준비 중                     |
| `ready-to-sync`   | 엔드포인트로 트래픽을 돌리고 동기화 시작 가능 |
| `initiating-sync` | 모든 샤드에서 복제 시작 중                    |
| `syncing`         | 복제 진행 중                                  |
| `cutting-over`    | 대상으로 전환 마무리 중                       |
| `stopping`        | 요청에 따라 동기화 중단 중                    |

마이그레이션 전용 지표나 진행률은 없다. 기존 Serverless 지표 중 `BytesUsedForCache`, `CurrItems`, `NetworkBytesIn`으로 데이터가 들어오는지 보는 게 가이드의 안내다. 단계별 이벤트와 실패 이유는 대상 캐시의 Events 탭에 남는다.

되돌리는 방법도 정해져 있다. 동기화 중에 Stop data sync를 누르면 `ready-to-sync`로 돌아가고, 그동안 애플리케이션은 계속 원본을 쓴다. 상태가 건강하지 않으면 `StartMigration`과 `CompleteMigration`이 `MigrationHealthFault`로 거부되는데, `CompleteMigration`에 `Force`를 주면 이 검사를 건너뛴다.

## 4. 시작 전에 걸러 둘 제약

- 원본이 클러스터 모드인지
- 대상 캐시가 비어 있는지
- 대상 캐시에 공개 엔드포인트가 없고, 네트워크 타입이 IPv6나 듀얼 스택이 아닌지. 어기면 `InvalidParameterValue`로 거부된다.
- 원본 접속 정보가 Secrets Manager에 들어 있는지. 원본 연결은 TLS와 인증을 쓴다.
- 모든 애플리케이션 인스턴스가 마이그레이션 엔드포인트로 넘어왔는지

TLS, AUTH, 네트워크 요건과 Secrets Manager 비밀 형식은 가이드의 Prerequisites, Source authentication 페이지에 따로 있다. 실제로 진행한다면 그 두 페이지부터 읽는 게 순서다.

## 참고 자료

- [Amazon ElastiCache Serverless for Valkey now supports online migration with zero downtime (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/10/amazon-elasticache-serverless-valkey-online-migration/)
- [Online migration to ElastiCache Serverless (ElastiCache 개발자 가이드)](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/migration-to-serverless.html)
