---
title: "GitHub Actions 로그 시크릿 스캔과 Dependabot 알림 자동 중지: 보안 알림이 늘고 줄어드는 자리"
description: "GitHub이 Actions 워크플로 로그를 시크릿 스캔 대상에 넣는 프리뷰를 시작했고, 12월 8일부터는 1년간 활동이 없는 레포의 Dependabot 알림을 끈다. 두 변경이 어디에 적용되고 무엇을 놓치는지 changelog 기준으로 정리했다."
date: 2026-11-11T09:40:00
update: 2026-11-11T09:40:00
tags:
  - GitHub
  - Security
  - DevOps
---

GitHub changelog에 보안 알림 관련 소식이 이틀 연달아 올라왔다. 11월 9일에는 시크릿 스캔이 GitHub Actions 워크플로 로그까지 보기 시작했고(퍼블릭 프리뷰), 11월 10일에는 12월 8일부터 1년 동안 활동이 없는 레포의 Dependabot 알림을 끈다는 공지가 나왔다. 한쪽은 알림이 생기는 자리가 늘고, 다른 쪽은 줄어든다.

로그 스캔은 기본으로 꺼져 있고 Dependabot 쪽은 조용히 꺼진다. 둘 다 가만히 있으면 모르고 지나가기 쉽다.

> 이번 변경으로 우리 레포에서 새로 잡히는 것과 더 이상 안 잡히는 것은 무엇인가?

> 이 글은 GitHub changelog 두 건과 시크릿 스캔 문서를 확인해 정리했다. 로그 스캔은 퍼블릭 프리뷰라서 동작이 바뀔 수 있다.

## 1. 워크플로 로그가 스캔 대상이 됐다

Actions는 등록된 secret 값을 `***`로 가려 주지만, 실행 중에 만들어진 토큰이나 디버깅용으로 출력한 환경 변수는 가리지 못한다. 이번 기능이 겨냥하는 빈틈이다.

워크플로 실행이 끝나면 GitHub이 그 로그를 provider 패턴으로 스캔한다. 찾은 결과는 레포의 시크릿 스캔 알림 목록에 코드에서 나온 알림과 함께 뜨고, 해당 Actions 로그로 가는 링크가 붙는다. 지원되는 시크릿 유형은 유효성 검사(validity check)도 돈다.

### 대상과 켜는 방법

| 항목     | 내용                                                   |
| -------- | ------------------------------------------------------ |
| 상태     | 퍼블릭 프리뷰                                          |
| 대상     | GitHub Enterprise Cloud(GHE.com 데이터 레지던시 포함)  |
| 라이선스 | GitHub Secret Protection 또는 GitHub Advanced Security |
| 기본값   | 꺼짐                                                   |

켜는 사람은 엔터프라이즈 소유자다. 엔터프라이즈 설정에서 `Policies` > `Advanced Security`로 가서 "Secret scanning for Actions workflow logs"의 `All repositories` 드롭다운을 `Enabled`로 바꾼다. 정책은 위 라이선스로 시크릿 스캔이 켜진 레포에만 적용된다.

## 2. 잡히지 않는 것들

개인적으로는 이 부분이 더 걸렸다. changelog가 직접 밝힌 제외 대상이 꽤 많다.

| 구분                   | 스캔 여부 | 비고                  |
| ---------------------- | --------- | --------------------- |
| provider 패턴          | 스캔함    | 실행 완료 후          |
| generic·custom 패턴    | 안 함     | 비밀번호류, 사내 토큰 |
| AI로 찾는 시크릿       | 안 함     | 코드 스캔과 다름      |
| Actions가 이미 가린 값 | 안 함     | `***`로 마스킹된 값   |
| 기능을 켜기 전 로그    | 안 함     | 소급 스캔 없음        |

provider 패턴만 본다는 건 DB 비밀번호나 사내 API 키처럼 형식이 정해지지 않은 값은 로그에 찍혀도 알림이 안 생긴다는 뜻이다.

알림은 로그가 지워진 뒤에도 남는다. 그런데 **프리뷰 기간에는 이 알림이 notification을 보내지 않는다.** 메일이나 웹 알림을 기다리면 놓친다. 레포의 시크릿 스캔 알림 목록을 직접 열어 봐야 한다.

## 3. 로그에 안 남기는 쪽이 먼저다

스캔은 사후 탐지다. 알림이 떴다면 이미 로그를 볼 수 있는 사람에게 노출된 뒤라 자격 증명을 교체하는 수밖에 없다.

secret으로 등록하지 않았지만 실행 중에 만들어지는 값은 `add-mask` 워크플로 명령으로 가릴 수 있다.

```yaml
- name: 임시 토큰 발급
  run: |
    TOKEN=$(./scripts/issue-token.sh)
    echo "::add-mask::$TOKEN"
    echo "TOKEN=$TOKEN" >> "$GITHUB_ENV"
```

이렇게 가려진 값은 앞 표대로 스캔 대상에서도 빠진다. 마스킹이 1차, 스캔이 그 뒤를 받치는 구조다.

## 4. Dependabot 알림은 조용히 꺼진다

두 번째 소식은 반대 방향이다. 12월 8일부터 GitHub은 지난 1년 동안 활동이 없는 레포 대부분에서 Dependabot 알림을 끈다. 기존 알림은 삭제가 아니라 보관(archive) 처리되고 언제든 되살릴 수 있다.

여기서 말하는 활동은 세 가지뿐이다.

- 아무 브랜치나 태그에 push
- 레포 생성
- Dependabot 알림 켜기

이 밖의 일은 활동으로 치지 않는다. push가 한 번이라도 있으면 알림이 자동으로 다시 켜지고, 레포 설정에서 직접 켜도 1년 기준이 다시 시작된다.

예외도 있다. 보안 구성(security configuration)을 강제 적용해 Dependabot 알림을 켜 둔 레포, 그리고 엔터프라이즈 정책상 레포 관리자가 알림을 켜고 끌 수 없는 레포는 건드리지 않는다. 적용 범위는 github.com의 모든 플랜과 데이터 레지던시 GHEC이고, GitHub Enterprise Server는 해당하지 않는다.

걸리는 건 1년 넘게 손대지 않았지만 여전히 돌아가는 내부 도구다. 의존성 취약점은 코드가 그대로여도 새로 생기니, 계속 감시할 레포라면 보안 구성으로 강제하는 편이 확실하다.

### 점검 목록

- GHEC에서 Secret Protection이나 GHAS를 쓴다면 로그 스캔 정책을 켤지 정한다
- 켰다면 프리뷰 동안은 알림 목록을 주기적으로 직접 확인한다
- 워크플로에서 env 전체 출력, 디버그 로그에 토큰을 남기는 단계가 없는지 본다
- 1년 넘게 push가 없는 운영 중 레포를 골라 보안 구성 강제 적용을 검토한다

## 참고 자료

- [Secret scanning detects secrets in GitHub Actions workflow logs (GitHub Changelog)](https://github.blog/changelog/2026-11-09-secret-scanning-detects-secrets-in-github-actions-workflow-logs)
- [Dependabot alerts will pause on inactive repositories (GitHub Changelog)](https://github.blog/changelog/2026-11-10-dependabot-alerts-will-pause-on-inactive-repositories)
- [About secret scanning (GitHub Docs)](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/secret-security/secret-scanning)
