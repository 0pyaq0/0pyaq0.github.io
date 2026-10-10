---
title: "GitHub 비밀값 탐지 전용 모델 도입: 형식 없는 비밀번호도 잡지만 AI Credits 과금은 따로 봐야 한다"
description: "GitHub가 10월 7일 유출된 비밀값 탐지에 전용 파인튜닝 모델을 도입했다. 기존 패턴 탐지와 무엇이 다른지, 어떤 기능이 무료이고 어떤 기능이 AI Credits를 쓰는지, 조직 관리자가 먼저 볼 설정을 changelog 기준으로 정리했다."
date: 2026-10-11T09:05:00
update: 2026-10-11T09:05:00
tags:
  - GitHub
  - Security
  - DevOps
---

GitHub가 10월 7일 secret scanning에 비밀값 탐지 전용으로 파인튜닝한 모델을 붙였다. 정해진 토큰 형식이 없는 비밀번호처럼 정규식으로는 잡기 어려운 값을, 주변 코드를 읽고 판단해서 찾아낸다. 기존 AI 탐지 비밀번호 알림을 쓰던 곳은 이미 새 모델로 자동 전환됐다. 그런데 같은 발표에 push protection과 Copilot `/security-review`로 확장되는 기능이 같이 묶여 있고, 이쪽은 AI Credits를 쓴다. 무료로 계속 쓰는 부분과 돈이 나가는 부분을 나눠서 봐야 한다.

> 새 탐지 모델은 무엇을 더 잡아 주고, 조직에서 켜기 전에 비용과 정책은 어떻게 정리해야 하나?

> 이 글은 GitHub Changelog의 10월 7일 발표와 10월 5일 탐지 패턴 추가 공지를 읽고 정리했다. AI push protection은 private preview 상태이고 과금 방식도 "앞으로 몇 주 안에" 도입된다고만 적혀 있어서 세부 내용은 바뀔 수 있다.

## 1. 패턴 탐지와 AI 탐지는 잡는 대상이 다르다

secret scanning은 원래 형식이 정해진 토큰을 찾는 데 강하다. 접두사와 길이, 문자 구성이 정해져 있으면 패턴 하나로 거의 확실하게 잡는다. 10월 5일에도 이런 패턴이 다섯 개 추가됐다.

| 제공자   | 토큰 타입                               |
| -------- | --------------------------------------- |
| Lovable  | `lovable_api_key`                       |
| Pydantic | `logfire_token`                         |
| Pydantic | `pydantic_ai_gateway_api_key`           |
| Supabase | `supabase_oauth_access_token`           |
| Supabase | `supabase_scoped_personal_access_token` |

문제는 비밀번호다. DB 비밀번호나 내부 서비스 계정 비밀번호는 아무 문자열이나 될 수 있어서 패턴으로는 거의 못 잡는다. 이번 모델은 이 빈자리를 노린다. changelog 표현으로는 주변 코드를 읽어서 자격 증명일 가능성이 높은 값을 찾고, 인식 가능한 토큰 형식이 없는 비밀번호도 포함한다. 코드나 문장을 생성하지 않는 분류 전용 모델이라는 점도 따로 적혀 있다.

백엔드 코드에서 떠올려 보면 대략 이런 값들이 대상이 된다.

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.internal:5432/orders
    username: orders_app
    password: "<평문 비밀번호>" # 형식은 없지만 문맥상 비밀번호
```

키 이름이 `password`이고 DB 접속 설정 안에 있다는 문맥이 판단 근거가 되는 종류다. 위 예시는 설명용으로 값을 비워 둔 것이고, 실제로 어떤 값에서 알림이 뜨는지는 확인해 보지 않았다.

## 2. 새 모델이 들어가는 세 군데

발표에 나온 적용 범위는 세 곳이다.

| 적용 위치                  | 하는 일                           | 상태                 |
| -------------------------- | --------------------------------- | -------------------- |
| secret scanning 알림       | 저장소의 비밀번호를 알림으로 표시 | 적용됨, 자동 전환    |
| push protection            | push 시점에 비정형 자격 증명 검사 | private preview      |
| Copilot `/security-review` | CLI·앱의 읽기 전용 리뷰에서 검사  | private preview 예정 |

이 중 실무에서 제일 기대되는 건 push protection이다. 알림은 이미 커밋 히스토리에 들어간 뒤에 뜨니까 결국 비밀번호를 바꾸고 히스토리를 정리해야 한다. push 단계에서 걸리면 히스토리에 들어가기 전에 지울 기회가 생긴다. 다만 changelog에는 탐지됐을 때 push를 막는지, 우회가 가능한지는 나오지 않는다. 기존 push protection처럼 동작할 거라고 짐작은 되지만 문서로 확인한 내용은 아니다.

## 3. 무료로 남는 것과 과금되는 것

**AI 탐지 비밀번호 알림은 GitHub Secret Protection(GHSP)과 GitHub Advanced Security(GHAS)에 계속 추가 비용 없이 포함된다.** 지금 쓰고 있다면 바뀌는 건 모델뿐이다.

새로 생기는 두 검사는 AI Credits를 쓴다.

- push protection 사용량은 저장소를 소유한 조직에 청구된다. push를 막지 않은 검사도 크레딧을 쓸 수 있다고 적혀 있다.
- `/security-review` 사용량은 쓰고 있는 Copilot 플랜의 결제 계정에 청구된다.
- 청구 항목 이름은 "Secret Protection AI Credits"다.
- 과금은 조직이 public preview에 옵트인하고 기능을 켠 뒤부터 시작된다.

개인적으로 가장 눈에 걸린 건 push protection 쪽이다. 막지 않은 push도 비용이 될 수 있다는 건 push가 많은 저장소일수록 사용량이 커진다는 뜻이다. 모노레포나 봇이 자주 push하는 저장소가 있는 조직이라면 켜기 전에 예산부터 잡아 두는 게 맞아 보인다.

플랜별 조건도 갈린다.

- AI push protection: GitHub Enterprise Cloud 또는 GitHub Team에 유료 GHSP·GHAS가 있어야 하고, 관리자가 켜야 한다.
- 보안 리뷰 검사: 개인 Copilot 플랜(Free, Pro, Pro+, Max, Student)은 GHSP·GHAS 라이선스 없이도 대상이다. Copilot Business·Enterprise도 대상이지만 push protection에 필요한 GHSP 라이선스를 대신하지는 않는다.
- GitHub Enterprise Server 3.23: AI 탐지 알림만 public preview로 들어가고, AI push protection과 `/security-review`는 빠졌다.

## 4. 켜기 전에 관리자가 할 일

예산은 이 순서로 잡는다고 안내돼 있다.

1. Billing and licensing에서 Budgets and alerts로 들어간다.
2. SKU 단위 예산을 고르고 Advanced Security 아래 Secret Protection AI Credits를 선택한다.
3. 가능한 경우 "Stop usage when budget limit is reached"를 켠다.

세 번째가 중요하다. 예산 알림만 걸어 두면 사용이 멈추지 않는다. 실제로 상한을 걸려면 이 옵션을 같이 켜야 한다.

보안 리뷰 검사는 기본으로 꺼져 있고, `/security-review` 명령을 실행한다고 켜지지 않는다. 관리자가 정책으로 막아 두면 개인이 옵트인해도 그 정책을 넘어서지 못한다. 이미 private preview로 AI push protection을 쓰고 있다면 과금이 시작된 뒤에도 그대로 크레딧을 쓰게 되니, 원하지 않으면 그 전에 꺼 두라는 안내도 있다.

## 5. 우리 조직에서 점검할 것

- GHSP·GHAS를 쓰고 있다면 AI 탐지 비밀번호 알림이 켜져 있는지, 새 모델 전환 뒤 알림 양이 달라졌는지
- 설정 파일에 비밀번호를 직접 넣는 저장소가 남아 있는지, 있다면 환경 변수나 시크릿 매니저로 옮길지
- AI push protection을 켤 조직과 저장소 범위, push가 잦은 저장소를 포함할지
- Secret Protection AI Credits 예산과 사용 중지 옵션
- Copilot `/security-review`의 보안 리뷰 검사를 조직 정책으로 허용할지
- Supabase, Pydantic Logfire 같은 새 패턴 대상 서비스를 쓰고 있다면 기존 알림이 새로 뜨지 않았는지

패턴 탐지는 정확하고 AI 탐지는 넓다. 둘이 겹치지 않는 영역을 맡는 구조라서, 비밀번호를 코드에 넣는 습관이 남아 있는 팀일수록 이번 변화의 영향이 클 것 같다.

## 참고 자료

- [Purpose-built model for leaked secret detection (GitHub Changelog)](https://github.blog/changelog/2026-10-07-purpose-built-model-for-leaked-secret-detection)
- [Secret scanning adds detectors for Lovable, Supabase, and more (GitHub Changelog)](https://github.blog/changelog/2026-10-05-secret-scanning-adds-detectors-for-lovable-supabase-and-more/)
- [Supported secret scanning patterns (GitHub Docs)](https://docs.github.com/code-security/secret-scanning/introduction/supported-secret-scanning-patterns)
- [Set up budgets (GitHub Docs)](https://docs.github.com/billing/how-tos/set-up-budgets)
