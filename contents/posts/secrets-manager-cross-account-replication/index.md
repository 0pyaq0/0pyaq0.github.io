---
title: "AWS Secrets Manager 계정 간 복제: 시크릿 공유를 리소스 정책 대신 복제로 푸는 법"
description: "Secrets Manager가 다른 AWS 계정으로 시크릿을 복제하는 기능을 내놨다. 기존 멀티 리전 복제와 무엇이 다르고, KMS 키와 권한을 어떻게 맞춰야 하는지 공식 문서 기준으로 정리했다."
date: 2026-11-15T09:40:00
update: 2026-11-15T09:40:00
tags:
  - AWS
  - Security
---

11월 13일 AWS Secrets Manager가 계정 간 복제(cross-account replication)를 지원하기 시작했다. 한 계정의 시크릿을 다른 계정에 읽기 전용 복제본으로 두고, 원본 값이 바뀌면 로테이션까지 포함해 자동으로 따라가게 하는 기능이다. 원본을 다른 계정에 직접 열어 주는 대신, 복제본을 각 계정 안에 두고 그 계정의 정책과 키로 관리하는 길이 생겼다.

> 계정 간 복제를 쓰면 무엇이 편해지고, 준비할 것은 무엇인가?

> 이 글은 AWS What's New 공지와 Secrets Manager 사용자 가이드, API 레퍼런스를 확인해 정리했다.

## 1. 멀티 리전 복제와 무엇이 다른가

공식 문서를 나란히 놓고 보니 성격이 꽤 다르다.

| 항목             | 멀티 리전 복제       | 계정 간 복제         |
| ---------------- | -------------------- | -------------------- |
| 복제 위치        | 같은 계정, 다른 리전 | 다른 계정, 같은 리전 |
| 복제본 수        | 리전마다 하나        | 원본당 최대 하나     |
| 태그·리소스 정책 | 함께 복제            | 복제 안 함           |
| KMS 키           | 리전별 지정          | 고객 관리형 키 필수  |

계정 간 복제본은 **자기 접근 정책, KMS 키, 수명 주기를 가진 독립 시크릿**이다. 값과 버전, 스테이징 레이블은 복제되고 태그와 리소스 정책은 복제되지 않는다.

같은 리전, 같은 파티션이어야 한다는 제약이 있다. 공지는 Secrets Manager가 제공되는 모든 리전에서 쓸 수 있다고 적었다.

## 2. 복제본은 읽기 전용이다

복제본에서는 값을 바꾸는 호출이 전부 막힌다. `PutSecretValue`, `UpdateSecret`, `DeleteSecret`, `RotateSecret`, `ReplicateSecretToRegions`, `RemoveRegionsFromReplication`은 `InvalidRequestException`을 돌려준다. 로테이션은 원본 계정에서만 돌고, 복제본은 그 결과를 받는다.

복제는 비동기이고 결국 일관성(eventually consistent) 모델이다. 처음 복제가 끝나기 전에는 복제본에 `GetSecretValue`를 호출하면 `ResourceNotFoundException`이 난다. 상태는 `DescribeSecret`에서 `Pending`, `InProgress`, `InSync`, `Failed`, `Detached` 중 하나로 보인다.

## 3. 설정 순서와 권한

설정은 두 계정이 한 번씩 손을 대야 끝난다.

1. 복제본 계정에서 원본 ARN과 자기 계정의 고객 관리형 KMS 키를 지정해 시크릿을 만든다.
2. 원본 계정에서 `AssociateCrossAccountReplica` API로 그 복제본을 연결한다.

1번은 문서에 나온 CLI 그대로다.

```bash
# 복제본 계정에서 실행
aws secretsmanager create-secret \
  --name MyReplicaSecret \
  --cross-account-primary-arn arn:aws:secretsmanager:ap-northeast-2:111122223333:secret:MyPrimarySecret-AbCdEf \
  --kms-key-id arn:aws:kms:ap-northeast-2:444455556666:key/REPLICA_KEY_ID
```

이때 Secrets Manager가 복제본에 원본 계정의 복제를 받아들이는 `cross-account-replication` 관리형 정책을 붙인다.

2번 연결에서 필요한 권한은 API 레퍼런스에 정리돼 있다.

| 계정      | 필요한 권한                                                     | 대상               |
| --------- | --------------------------------------------------------------- | ------------------ |
| 원본      | `secretsmanager:AssociateCrossAccountReplica`, `GetSecretValue` | 원본 시크릿        |
| 원본      | `kms:Decrypt`                                                   | 원본 KMS 키        |
| 복제본 측 | `secretsmanager:AcceptCrossAccountReplication`, `kms:Encrypt`   | 복제본 시크릿과 키 |

개인적으로는 KMS 쪽이 더 걸렸다. 복제본은 `aws/secretsmanager` 키를 쓸 수 없어서, 복제본 KMS 키 정책에 원본 계정이 `kms:Encrypt`를 호출할 수 있도록 `kms:CallerAccount`와 `kms:EncryptionContext:SecretARN` 조건을 건 문장을 넣어야 한다.

연결할 때는 `ReplicationRoleARN`으로 원본 계정의 IAM 역할을 지정하는 방식을 문서가 권한다. 역할이 없으면 Secrets Manager가 호출자의 권한(forward access session)으로 복제한다. 이 경우 `PutSecretValue`를 호출하는 쪽, 즉 로테이션 Lambda 같은 주체까지 복제본 키에 대한 `kms:Encrypt` 권한이 있어야 하고, 없으면 상태가 `Failed`가 된다. `ReplicaRestriction` 기본값은 `SameOrg`라서, 같은 AWS Organizations 밖 계정으로 보내려면 `NoRestriction`을 명시해야 한다.

## 4. 끊기와 삭제

어느 쪽에서든 복제를 멈출 수 있다. 원본 계정은 `disassociate-cross-account-replica`, 복제본 계정은 `stop-replication-to-replica`를 쓴다. 후자는 복제본을 독립 시크릿으로 승격시키고, 복제본 쪽 호출자에게 `secretsmanager:DeleteResourcePolicy` 권한이 필요하다.

삭제는 순서가 정해져 있다. 각 계정은 자기 쪽에서 복제를 멈추기 전까지 시크릿을 지울 수 없다. 원본을 지우려면 먼저 연결을 끊고, 복제본을 지우려면 먼저 승격시킨다.

### 점검 목록

- 다른 계정에서 원본 시크릿을 직접 읽게 열어 둔 리소스 정책이 있는지 찾고, 복제로 바꿀 대상을 고른다
- 복제본 계정에 고객 관리형 KMS 키를 준비하고 키 정책에 원본 계정 조건을 넣는다
- `ReplicationRoleARN`용 역할을 만들어 로테이션 주체의 권한 문제를 피한다
- 복제본 상태가 `InSync`가 된 뒤에 소비 측 배포가 진행되도록 순서를 맞춘다

## 참고 자료

- [AWS Secrets Manager now supports cross-account replication (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/11/secrets-manager-cross-account/)
- [Replicate secrets across AWS accounts (Secrets Manager 사용자 가이드)](https://docs.aws.amazon.com/secretsmanager/latest/userguide/cross-account-replicate-secrets.html)
- [Permissions for cross-account replication (Secrets Manager 사용자 가이드)](https://docs.aws.amazon.com/secretsmanager/latest/userguide/cross-account-replicate-permissions.html)
- [AssociateCrossAccountReplica (Secrets Manager API 레퍼런스)](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_AssociateCrossAccountReplica.html)
