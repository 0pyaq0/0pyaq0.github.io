---
title: "GitHub Actions pull_request_target 기본 차단: 12월 2일 전에 공개 레포에서 확인할 것"
description: "공개 레포에서 pull_request_target 이벤트가 12월 2일부터 기본으로 막힌다. 11월 브라운아웃 일정, 정책 인사이트로 영향 확인하는 법, 예외를 열기 전에 볼 안전 수칙을 정리했다."
date: 2026-11-04T09:40:00
update: 2026-11-04T09:40:00
tags:
  - GitHub
  - Security
  - DevOps
---

GitHub가 11월 2일 공지로 **공개 레포지토리의 `pull_request_target` 이벤트를 2026년 12월 2일부터 기본 차단한다**고 밝혔다. 원래 11월 2일이던 시행일이 한 달 미뤄졌고, 그 사이 11월 9일과 16일에 두 시간씩 실제로 막아 보는 브라운아웃이 잡혀 있다. 포크에서 온 PR에 라벨을 달거나 댓글을 남기는 워크플로를 이 트리거로 돌리고 있다면, 브라운아웃 시간대에 그 실행이 실패한다.

> 우리 공개 레포의 워크플로 중 무엇이 막히고, 계속 써야 한다면 어떻게 예외를 여는가?

> 이 글은 GitHub changelog 공지와 Actions 문서의 워크플로 실행 제어, pull_request_target 안전 사용 문서를 읽고 정리했다.

## 1. 무엇이 바뀌나

`pull_request_target`으로 실행되는 워크플로는 기본 브랜치의 워크플로 파일로 돌지만, 기본 레포의 `GITHUB_TOKEN`과 레포·조직 시크릿에 접근한다. 포크 코드를 체크아웃해서 실행하는 순간 그 코드가 시크릿을 들고 돌게 된다. 문서는 이 패턴을 "pwn request"라고 부르고 여러 공급망 사고의 원인이었다고 적었다.

이번 변경은 이 트리거를 아예 기본으로 막는 쪽을 택했다. 적용 범위는 이렇다.

| 항목           | 대상                           | 비고                      |
| -------------- | ------------------------------ | ------------------------- |
| 레포 공개 범위 | 공개 레포만                    | 비공개·내부 레포는 제외   |
| 플랜           | Free, Team, Enterprise Cloud   | Enterprise Server는 제외  |
| 기존 정책      | 이미 이벤트 정책이 있으면 유지 | 기본 정책이 대신하지 않음 |

지금 이 기본 규칙은 evaluate 모드로 돌고 있다. 워크플로는 경고와 함께 그대로 실행되고, 막혔을 실행이 기록만 된다.

## 2. 일정

| 날짜 (UTC)            | 동작                  |
| --------------------- | --------------------- |
| 지금 ~ 11월 9일       | evaluate 모드, 경고만 |
| 11월 9일 16:00~18:00  | 브라운아웃, 실제 차단 |
| 11월 16일 16:00~18:00 | 브라운아웃, 실제 차단 |
| 12월 2일              | 기본 차단 시행        |

브라운아웃 동안 막힌 실행은 오류 주석을 남기고 실행되지 않는다. 끝나면 다시 evaluate 모드로 돌아간다. 한국 시간으로는 각각 다음 날 새벽 1시부터 3시다. 국내 팀이라면 자고 있을 시간이라 브라운아웃으로 영향을 알아채기 어렵다. 개인적으로는 이 점 때문에 인사이트로 미리 확인하는 게 더 필요해 보였다.

## 3. 영향받는 워크플로 찾기

공지가 권하는 첫 단계는 11월 9일 전에 인사이트로 막힐 실행을 확인하는 것이다. 위치는 레포나 조직의 **Settings → Actions → Policies** 아래에 있는 **Policy insights** 페이지다. 엔터프라이즈는 **Policies** 탭에서 들어간다. 이 페이지에 실제로 막힌 실행과 evaluate 정책이었다면 막혔을 실행이 함께 나온다.

레포 안에서 먼저 훑어보는 것도 간단하다.

```bash
# 이 트리거를 쓰는 워크플로 찾기
grep -rln "pull_request_target" .github/workflows/

# PR 쪽 코드를 가져오는 곳 찾기
grep -rn "head.sha\|head.ref\|gh pr checkout" .github/workflows/
```

두 검색에 모두 걸리는 워크플로가 있다면 차단 여부와 별개로 다시 볼 대상이다.

## 4. 계속 써야 한다면

공지는 두 가지 선택지를 준다. 기본 규칙을 그대로 두고 차단을 받아들이거나, Actions 이벤트 정책에서 이 이벤트를 명시적으로 허용하는 것이다. 허용할 때는 워크플로 파일 단위로 대상을 좁힐 수 있다. 레포 전체가 아니라 꼭 필요한 워크플로만 열라는 뜻이다. 문서도 꼭 필요할 때만 허용하라고 적었다.

예외를 열기 전에 안전 사용 문서의 원칙을 다시 볼 만하다. 문서가 위험한 예시로 든 형태는 이렇다.

```yaml
# 안전하지 않은 예시
on:
  pull_request_target:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - name: Test
        run: make test
```

PR 쪽 `Makefile`이 기본 레포의 토큰과 시크릿을 쥔 채 실행된다. 문서는 위험이 체크아웃 자체가 아니라 그다음에 그 코드를 실행하는 단계에서 완성된다고 설명한다. `npm install`이나 설정 파일, 의존성을 통해서도 실행이 일어난다는 점도 짚었다.

안전하게 쓰는 기준은 이렇게 정리돼 있다.

- 시크릿이 필요 없으면 `pull_request`를 쓴다. 읽기 전용 토큰으로 돌고 시크릿이 없다.
- PR 코드를 다루는 부분과 시크릿을 쓰는 부분을 다른 워크플로로 나눈다.
- 체크아웃한 PR 코드는 데이터로만 읽고 절대 실행하지 않는다.
- `GITHUB_TOKEN` 권한은 최소로, 시크릿은 필요한 것만 쓴다.

참고로 `actions/checkout`에도 포크 PR의 head ref 체크아웃을 막는 보호가 있고, 풀려면 `allow-unsafe-pr-checkout: true`를 줘야 한다. 다만 `git fetch`, `gh pr checkout`, 내려받은 아티팩트는 이 보호가 덮지 않는다.

### 점검 목록

- 공개 레포에서 `pull_request_target`을 쓰는 워크플로를 목록으로 만든다
- Policy insights에서 막힐 실행을 확인한다
- 시크릿이 필요 없는 워크플로는 `pull_request`로 바꾼다
- 남길 워크플로는 PR 코드를 실행하지 않는지 다시 본다
- 예외 정책은 워크플로 파일 단위로 좁혀서 연다
- 12월 2일 이후 첫 외부 PR에서 동작을 확인한다

## 참고 자료

- [pull_request_target blocked by default December 2](https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2)
- [Control workflow execution](https://docs.github.com/actions/how-tos/administer/control-workflow-execution)
- [Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
