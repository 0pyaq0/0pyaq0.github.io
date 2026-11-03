---
title: "Amazon MSK TLS 1.3 지원: 보안 정책 세 단계와 롤링 재시작 전에 볼 것"
description: "MSK Provisioned 클러스터에서 TLS 1.3을 쓸 수 있게 됐다. tls.security.policy 값 세 가지, 한 칸씩만 움직이는 전환 규칙, 클라이언트 쪽 확인 사항을 공식 문서 기준으로 정리했다."
date: 2026-11-03T09:40:00
update: 2026-11-03T09:40:00
tags:
  - AWS
  - Kafka
  - Security
---

10월 30일부터 **Amazon MSK Provisioned 클러스터에서 TLS 1.3을 쓸 수 있다**. 기본값은 여전히 TLS 1.2이고, 클러스터 설정에 보안 정책을 지정해야 켜진다. 적용하면 브로커가 롤링 재시작되고, 정책은 한 번에 한 단계씩만 바뀐다.

> MSK에서 TLS 1.3을 켜려면 무엇을 바꾸고, 어떤 클라이언트가 끊길 수 있는가?

> 이 글은 AWS What's New 공지와 MSK 개발자 가이드의 TLS 보안 정책 문서를 읽고 정리했다. MSK Serverless는 대상이 아니다.

## 1. 정책 세 가지

정책은 `tls.security.policy`라는 브로커 설정 속성으로 고른다. 값은 세 개뿐이고 대소문자까지 정확히 맞아야 한다.

| 정책                      | TLS 1.2 | TLS 1.3 | 비고                    |
| ------------------------- | ------- | ------- | ----------------------- |
| `MSK-TLS1.2-Default-2026` | 허용    | 거부    | 속성이 없을 때의 기본값 |
| `MSK-TLSv1.3-2026`        | 허용    | 허용    | 가장 높은 버전으로 협상 |
| `MSK-TLSv1.3-Only-2026`   | 거부    | 허용    | 1.3 못 하면 연결 거부   |

가운데 정책은 TLS 1.3을 더하기만 하고 TLS 1.2 암호 스위트는 빼지 않아서 현실적인 첫 단계다. 다만 클라이언트가 TLS 1.3으로 협상했다가 핸드셰이크가 실패하면 TLS 1.2로 내려가지 않는다.

TLS 1.3 암호 스위트는 `TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA384` 두 개만 지원한다. `TLS_CHACHA20_POLY1305_SHA256`은 지원하지 않아서, 이것만 제시하는 클라이언트는 TLS 1.3 핸드셰이크를 끝내지 못한다.

개인적으로 의외였던 건 적용 범위다. 정책은 클라이언트 연결만이 아니라 **MSK가 관리하는 모든 암호화 링크**에 걸린다. KRaft 모드라면 클라이언트와 브로커, 브로커 간 복제, 브로커와 컨트롤러, 컨트롤러 쿼럼까지다. ZooKeeper 모드라면 ZooKeeper 쪽 링크가 들어간다.

## 2. 적용 조건과 방법

Provisioned 클러스터, Apache Kafka 3.6 이상, 다른 작업이 없는 `ACTIVE` 상태가 조건이다. 별도 API는 없고 설정(configuration) 리비전을 적용하는 평소 방식 그대로다.

```bash
# 1. 기존 설정 내용에 정책 한 줄을 더한 server.properties 준비
echo "tls.security.policy=MSK-TLSv1.3-2026" >> server.properties

# 2. 설정 생성
aws kafka create-configuration \
  --name tls13-additive \
  --kafka-versions <KAFKA_VERSION> \
  --server-properties fileb://server.properties

# 3. 클러스터에 리비전 적용 (CURRENT_VERSION은 describe-cluster의 CurrentVersion)
aws kafka update-cluster-configuration \
  --cluster-arn <CLUSTER_ARN> \
  --current-version <CURRENT_VERSION> \
  --configuration-info '{"Arn":"<CONFIGURATION_ARN>","Revision":1}'
```

새 리비전은 기존 설정을 통째로 대체하므로 쓰던 속성을 같이 넣어야 한다.

### 롤링 재시작

적용하면 브로커가 한 대씩 재시작되고, 클라이언트는 재연결하면서 새 정책으로 협상한다. 재시작 중 트래픽을 계속 받으려면 조건이 있다.

- 토픽 복제 계수가 3 이상
- `min.insync.replicas`가 복제 계수보다 1 이상 작음
- 클라이언트가 재시도함

## 3. 한 칸씩만 움직인다

기존 클러스터는 정책을 한 번에 한 칸씩만 옮길 수 있다. 올릴 때도 내릴 때도 같다.

```text
MSK-TLS1.2-Default-2026  <->  MSK-TLSv1.3-2026  <->  MSK-TLSv1.3-Only-2026
```

그러니 기본값에서 TLS 1.3 전용으로 가려면 업데이트가 두 번이고, 롤링 재시작도 두 번이다. 새로 만드는 클러스터만 처음부터 `MSK-TLSv1.3-Only-2026`을 고를 수 있다.

되돌릴 때도 같다. 전용 정책인 클러스터에서 속성을 지우면 두 칸 이동 요청이 되어 거부된다. 속성 삭제는 빠져나오는 방법이 아니다.

문서에 정리된 오류는 이렇다.

| 오류 메시지                                       | 원인               | 대응                    |
| ------------------------------------------------- | ------------------ | ----------------------- |
| `Invalid value ... for tls.security.policy`       | 값 오타나 대소문자 | 세 값 중 하나로 정확히  |
| `Cannot change ... in one step`                   | 두 칸 이동 시도    | 가운데 정책을 먼저 적용 |
| `Unsupported config ... for Apache Kafka version` | Kafka 3.6 미만     | 버전 업그레이드 후 적용 |

## 4. 클라이언트와 중간 장비

클라이언트의 TLS 라이브러리가 TLS 1.3을 RFC 8446대로 구현해야 한다. 일부 오래된 구현은 협상 대신 핸드셰이크를 끊는다고 한다. 중간의 방화벽, 프록시, 로드밸런서, 트래픽 검사 장비도 TLS 1.3을 처리해야 한다.

권장 순서는 운영이 아닌 클러스터에 `MSK-TLSv1.3-2026`부터 적용해 클라이언트 연결을 확인하는 것이다.

브로커별로 Kafka admin API를 써서 `ssl.enabled.protocols` 같은 속성을 직접 바꾸지 말라는 경고도 있다. 설정 리비전은 `ssl.*` 키를 거부하지만 admin API는 막지 않는다. 정책과 겹치는 암호 스위트가 없으면 브로커가 뜨지 않거나 복제가 끊길 수 있고, 모든 브로커가 그렇게 되면 AWS Support를 통해서만 복구된다고 한다.

### 점검 목록

- 클러스터가 Provisioned이고 Kafka 3.6 이상인지 확인한다
- 복제 계수와 `min.insync.replicas`가 롤링 재시작을 버티는지 본다
- 클라이언트 언어별 TLS 라이브러리의 TLS 1.3 지원 여부를 정리한다
- 중간에 TLS를 검사하는 장비가 있는지 확인한다
- 기존 설정 속성을 모두 포함한 새 리비전을 만든다
- 개발 클러스터에 `MSK-TLSv1.3-2026`을 먼저 적용한다
- 브로커별 `ssl.*` 직접 수정 이력이 없는지 확인한다

## 참고 자료

- [Amazon MSK now supports TLS 1.3 for data in transit](https://aws.amazon.com/about-aws/whats-new/2026/10/amazon-msk-tls/)
- [TLS security policies for Amazon MSK](https://docs.aws.amazon.com/msk/latest/developerguide/msk-tls-security-policies.html)
- [Amazon MSK encryption](https://docs.aws.amazon.com/msk/latest/developerguide/msk-encryption.html)
