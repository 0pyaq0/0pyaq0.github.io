---
title: "CloudFormation --force-rollback: UPDATE_ROLLBACK_FAILED를 한 번에 빠져나오는 대신 남는 것"
description: "10월 22일 CloudFormation에 롤백이 막힌 스택을 한 번에 정리하는 force rollback 옵션이 추가됐다. 기존 --resources-to-skip과의 차이, 건너뛴 리소스가 남기는 불일치, 다음 배포 전에 할 일을 공식 문서 기준으로 정리했다."
date: 2026-10-25T09:40:00
update: 2026-10-25T09:40:00
tags:
  - AWS
  - DevOps
---

CloudFormation 스택이 `UPDATE_ROLLBACK_FAILED`에 빠졌을 때, 이제 `continue-update-rollback`에 `--force-rollback`을 붙이면 롤백을 한 번에 끝낼 수 있다. 지금까지는 롤백에 실패한 리소스를 하나씩 찾아 논리 ID 목록을 만들고 `--resources-to-skip`으로 넘겨야 했다. 중첩 스택이 섞여 있으면 이름 찾는 것부터 일이었다. 대신 건너뛴 리소스는 템플릿과 어긋난 채로 남고, 이걸 정리하지 않고 다음 배포를 하면 스택이 복구 불가능해질 수 있다. 편해진 만큼 뒷정리가 따라붙는 기능이다.

> 롤백이 막힌 스택을 force rollback으로 풀면 무엇이 남고, 다음 배포 전에 무엇을 해야 하나?

> 이 글은 10월 22일 AWS What's New 공지와 CloudFormation 사용 설명서의 "Continue rolling back an update" 페이지를 확인해 정리했다.

## 1. UPDATE_ROLLBACK_FAILED는 왜 생기나

스택 업데이트가 실패하면 CloudFormation은 이전 상태로 되돌리려 한다. 이 되돌리기조차 실패한 상태가 `UPDATE_ROLLBACK_FAILED`다. 문서가 드는 예시는 이렇다. 롤백 대상인 옛 DB 인스턴스를 누군가 CloudFormation 밖에서 지워 버렸다. CloudFormation은 그 사실을 모르고 인스턴스가 있다고 가정한 채 되돌리려다 실패한다.

이 상태의 스택은 업데이트할 수 없다. 할 수 있는 건 롤백을 이어서 `UPDATE_ROLLBACK_COMPLETE`로 만드는 것뿐이다. 타임아웃처럼 일시적인 원인이면 아무것도 바꾸지 않고 다시 이어도 되지만, 대부분은 원인을 먼저 고치라는 게 문서의 안내다.

```bash
aws cloudformation continue-update-rollback --stack-name MyStack
```

## 2. 두 가지 건너뛰기 방식

원인을 고칠 수 없는 리소스가 있으면 건너뛰는 수밖에 없다. 기존 방식과 새 방식을 비교하면 이렇다.

| 항목      | `--resources-to-skip`            | `--force-rollback`             |
| --------- | -------------------------------- | ------------------------------ |
| 대상 지정 | 논리 ID를 직접 나열              | 롤백에 실패한 리소스 전부 자동 |
| 중첩 스택 | `NestedStackName.LogicalID` 형식 | 중첩 스택 리소스도 포함        |

기존 방식은 이렇게 썼다.

```bash
aws cloudformation continue-update-rollback --stack-name WebInfra \
  --resources-to-skip myCustom WebInfra-Compute-Asg.myAsg WebInfra-Storage.DB
```

새 방식은 플래그 하나다.

```bash
aws cloudformation continue-update-rollback --stack-name MyStack \
  --force-rollback
```

force rollback은 롤백 실패로 `UPDATE_FAILED`가 된 리소스를 모두 건너뛰고, 상태를 `UPDATE_COMPLETE`, 사유를 `Resource skipped during UpdateRollback`으로 남긴다. 롤백이 끝나면 스택 상태 사유에도 건너뛴 리소스가 있다고 적힌다. **정방향 업데이트 중에 실패한 리소스는 건너뛰지 않는다.** 롤백 단계에서 실패한 것만 대상이다. 두 플래그는 한 요청에 같이 쓸 수 없다.

## 3. 건너뛴 리소스는 템플릿과 어긋난다

문서에서 가장 강하게 경고하는 부분이 여기다. 롤백이 끝나면 건너뛴 리소스는 스택 템플릿과 더 이상 맞지 않는다. 다음 업데이트 전에 스택이나 리소스를 서로 맞춰 두지 않으면, 이후 업데이트가 실패하고 스택이 복구 불가능해질 수 있다고 적혀 있다.

개인적으로 걸렸던 건 드리프트 감지 결과다. 건너뛴 리소스는 드리프트 감지에서 `NOT_CHECKED`로 나온다. 스택 전체 드리프트 감지를 돌려 보고 "드리프트 없음"이라고 안심하면 안 된다는 뜻이다. 건너뛴 리소스는 하나씩 따로 확인해야 한다.

```bash
aws cloudformation detect-stack-resource-drift \
  --stack-name MyStack \
  --logical-resource-id DB
```

공지는 다음 배포 전에 drift-aware change set을 만들어 실제 리소스와 템플릿의 차이를 먼저 보라고 권한다. 문서가 `--resources-to-skip`을 쓸 때 "롤백에 필요한 최소한의 리소스만 지정하라"고 했던 것과 같은 맥락이다. force rollback은 그 최소한을 자동으로 고르는 대신, 몇 개를 건너뛰었는지 사람이 나중에 확인해야 한다.

## 4. 써야 할 때와 할 일

force rollback이 맞는 경우는 롤백 실패 원인을 고칠 수 없거나 고칠 가치가 없을 때다. 문서 예시처럼 CloudFormation 밖에서 지워진 리소스가 그렇다. 원인을 고칠 수 있으면 고치고 그냥 `continue-update-rollback`을 다시 돌리는 게 뒷정리가 없다.

쓴 뒤에 할 일을 정리하면 이렇다.

1. 스택 이벤트에서 `Resource skipped during UpdateRollback` 사유가 붙은 리소스를 모두 찾는다.
2. 각 리소스에 `detect-stack-resource-drift`를 돌려 템플릿과 실제 상태를 비교한다.
3. 템플릿을 실제 상태에 맞추거나, 리소스를 템플릿에 맞게 되돌린다.
4. drift-aware change set으로 차이가 정리됐는지 확인한 뒤 다음 업데이트를 진행한다.
5. CI/CD 파이프라인이 롤백 실패 시 자동으로 force rollback을 돌리게 만들지는 않는다. 뒷정리 없이 다음 배포가 이어지면 문서가 경고한 상황이 된다.

## 참고 자료

- [AWS CloudFormation now simplifies stack update rollback operations (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-cloudformation-cdk/)
- [Continue rolling back an update (CloudFormation 사용 설명서)](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html)
