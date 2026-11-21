---
title: "AWS STS GetScopedCredentials: 지금 쥔 임시 자격 증명을 그 자리에서 더 좁힌다"
description: "11월 19일 AWS STS에 GetScopedCredentials API가 추가됐다. 역할을 다시 assume하지 않고 현재 세션의 권한과 만료 시간을 줄이는 방식, 제약, CloudTrail 기록을 API 레퍼런스와 IAM 문서 기준으로 정리했다."
date: 2026-11-21T09:40:00
update: 2026-11-21T09:40:00
tags:
  - AWS
  - Security
---

AWS STS에 `GetScopedCredentials`가 생겼다. 이미 가진 임시 자격 증명을 넣으면 권한이 더 좁고 만료가 더 짧은 자격 증명을 돌려준다. 지금까지 같은 일을 하려면 같은 역할을 세션 정책과 함께 다시 assume해야 했고, 그러면 역할 체이닝 1시간 제한에 걸렸다. 워커에 작업 하나를 맡길 때 권한을 그 크기로 잘라 넘기기 쉬워졌다.

> 이미 받은 역할 세션의 권한을, 역할을 다시 assume하지 않고 줄일 수 있을까?

> 이 글은 AWS What's New 공지, STS API 레퍼런스, IAM 사용 설명서의 GetScopedCredentials 페이지, AWS CLI 레퍼런스를 읽고 정리했다. 요금 언급은 읽은 문서에 없었다.

## 1. 무엇을 넣고 무엇을 받나

요청 파라미터는 네 개이고 모두 선택이다. 다만 `Policy`와 `DurationSeconds` 중 하나는 꼭 있어야 한다.

| 파라미터                   | 타입    | 범위     | 설명                                      |
| -------------------------- | ------- | -------- | ----------------------------------------- |
| `Policy`                   | String  | 1~2048자 | 인라인 JSON scope-down 정책               |
| `DurationSeconds`          | Integer | 1~129600 | 생략하면 호출 세션의 남은 수명을 이어받음 |
| `MinimumSessionTokenSize`  | Integer | 0~4096   | 세션 토큰을 이 크기 이상으로 패딩         |
| `ScopedSessionDescription` | String  | 2~256자  | 세션 목적, CloudTrail에 기록됨            |

정책 ARN 파라미터는 없고 인라인 정책만 받는다.

응답에는 `Credentials`(AccessKeyId, SecretAccessKey, SessionToken, Expiration) 외에 `ScopedPoliciesCount`, `SessionInfo`, `SessionTokenSize`, `SessionTokenUtilization`, `SourceIdentity`가 온다. `ScopedPoliciesCount`는 쌓인 층 수다.

CLI 레퍼런스(2.42.0)의 옵션 이름으로 만들면 이런 모양이 된다. 레퍼런스에 예시 명령은 없어서 옵션 이름에 맞춰 직접 조립했다.

```bash
aws sts get-scoped-credentials \
  --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::amzn-s3-demo-bucket/reports/*"}]}' \
  --duration-seconds 900 \
  --scoped-session-description "report-export-job"
```

## 2. 권한은 겹겹이 쌓이고 줄어들기만 한다

AssumeRole의 세션 정책과 가장 다른 부분이다. 역할을 다시 assume하면서 넘긴 세션 정책은 이전 세션 정책을 대체한다. `GetScopedCredentials`는 호출할 때마다 층을 하나 더한다. 최종 권한은 호출자가 원래 가진 유효 권한(자격 증명 정책, 세션 정책, 권한 경계, SCP, RCP, VPC 엔드포인트 정책)과 모든 층의 교집합이다.

- 결과 자격 증명으로 다시 `GetScopedCredentials`를 부를 수 있다.
- **세션당 scope-down 층은 최대 3개**다. 네 번째로 `Policy`를 넣으면 거부된다.

막고 싶은 액션만 빼는 패턴도 문서에 예시로 있다. `Allow`에 `NotAction`을 쓰는 방식이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "NotAction": [
        "ec2:TerminateInstances",
        "rds:DeleteDBInstance",
        "s3:DeleteObject",
        "sts:AssumeRole*"
      ],
      "Resource": "*"
    }
  ]
}
```

`sts:AssumeRole*`를 빼 두는 게 눈에 띈다. 다른 역할을 assume해 제약을 벗어나는 길을 막는 용도로 읽혔다.

## 3. 시간도 줄어들기만 한다

`DurationSeconds`는 호출 세션의 남은 수명보다 길게 줄 수 없다. 길게 주면 `InsufficientSessionLifetime` 오류가 난다. 생략하면 부모 세션의 만료를 그대로 쓴다. IAM 문서는 역할 체이닝의 1시간 제한이 이 API에는 걸리지 않는다고 적고 있다.

조직 차원에서 상한을 두려면 `sts:DurationSeconds` 조건 키를 쓴다. 문서에는 900초보다 긴 요청을 SCP로 막는 예시가 있다.

```json
{
  "Effect": "Deny",
  "Action": "sts:GetScopedCredentials",
  "Resource": "*",
  "Condition": {
    "NumericGreaterThan": { "sts:DurationSeconds": "900" }
  }
}
```

## 4. 누가 부를 수 있고, 무엇이 그대로 남나

호출하려면 `sts:GetScopedCredentials` 액션 허용이 필요하다. 그리고 임시 자격 증명으로만 부를 수 있다. IAM 사용자나 루트 자격 증명으로는 안 되고, IAM 사용자라면 `GetSessionToken`으로 세션을 먼저 받아야 한다. STS 글로벌 엔드포인트에서는 지원하지 않으니 리전 엔드포인트를 써야 한다.

| 항목                          | 동작                                                      |
| ----------------------------- | --------------------------------------------------------- |
| 주체 ARN, 역할 세션 이름      | 그대로 유지                                               |
| 세션 태그, source identity    | 유지, 추가나 변경 불가                                    |
| `aws:SourceIp` 등 컨텍스트 키 | 유지                                                      |
| 폐기                          | 부모의 `aws:TokenIssueTime`을 이어받아 부모와 함께 폐기됨 |

좁힌 자격 증명만 따로 폐기하는 방법은 없다.

같은 계정 리소스 정책이 세션 주체를 허용해도, 자격 증명 정책과 scope-down 정책이 둘 다 허용해야 한다. 리소스 정책으로 우회되지 않는다.

## 5. CloudTrail에서 보이는 것

이벤트 이름은 `GetScopedCredentials`, 소스는 `sts.amazonaws.com`이다. `requestParameters`에 정책, 설명, 기간이 남고 `responseElements`에 `scopedPoliciesCount`와 토큰 크기 정보가 남는다. 설명 필드에 작업 ID를 넣어 두면 추적이 편하겠다.

### 점검 목록

- [ ] 작업 단위로 역할을 다시 assume하던 코드가 있다면 이 API로 바꿀 수 있는지 본다
- [ ] 좁힌 정책에 `sts:AssumeRole*`이 빠져 있는지 확인한다
- [ ] STS 클라이언트가 글로벌이 아니라 리전 엔드포인트를 쓰는지 확인한다
- [ ] 필요하면 SCP로 `sts:DurationSeconds` 상한을 둔다

## 참고 자료

- [AWS STS announces GetScopedCredentials](https://aws.amazon.com/about-aws/whats-new/2026/11/sts-getscopedcredentials/)
- [GetScopedCredentials API Reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetScopedCredentials.html)
- [Permissions for GetScopedCredentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_getscopedcredentials.html)
- [AWS CLI get-scoped-credentials](https://docs.aws.amazon.com/goto/cli2/sts-2011-06-15/GetScopedCredentials)
