---
title: "GitHub 비인증 HTTPS clone 일시 제한: CI의 익명 clone부터 점검한다"
description: "10월 19일 GitHub가 트래픽 이상 시 공개 저장소의 비인증 HTTPS clone과 fetch에 로그인을 요구할 수 있다고 공지했다. 영향 범위와 CI에서 인증을 붙이는 방법을 정리했다."
date: 2026-10-20T09:40:00
update: 2026-10-20T09:40:00
tags:
  - GitHub
  - DevOps
---

GitHub가 트래픽이 비정상적으로 몰릴 때 공개 저장소의 **비인증 HTTPS clone과 fetch**에 일시적으로 인증을 요구할 수 있다고 10월 19일 공지했다. 공개 저장소라서 토큰 없이 clone하던 CI 단계가 있다면, 평소엔 멀쩡하다가 어느 날 갑자기 인증 오류로 빌드가 깨질 수 있다는 얘기다. 미리 인증을 붙여 두면 영향이 없다.

> 우리 파이프라인 중 어디가 영향을 받고, 무엇을 바꿔 두면 되나?

> 이 글은 GitHub changelog 공지와 GitHub 인증 문서, actions/checkout README를 확인해 정리했다. 제한이 언제 걸리고 풀리는지는 공지에 나와 있지 않다.

## 1. 무엇이 바뀌었나

공지 내용은 짧다. 비정상 트래픽과 연관된 신호를 기준으로, 일부 비인증 HTTPS Git 작업에 로그인을 요구할 수 있다. GitHub는 이를 "가능한 한 좁게" 적용한다고 했고, 공개 저장소 전반에 인증을 의무화하는 건 아니라고 못 박았다. 목적은 트래픽 급증 때 github.com의 가용성을 지키는 것이다.

문제는 정상 트래픽과 비정상 트래픽이 같은 신호를 공유할 수 있다는 점이다. 공지도 정상적인 비인증 작업이 영향을 받을 수 있다고 인정한다. 모든 플랜의 github.com 저장소가 대상이다.

| 구분                     | 영향 여부    |
| ------------------------ | ------------ |
| 비인증 HTTPS clone/fetch | 받을 수 있음 |
| 인증된 HTTPS Git 작업    | 없음         |
| SSH Git 작업             | 없음         |
| push                     | 없음         |
| 웹, API 트래픽           | 없음         |

영향을 받으면 인증이 필요하다는 메시지와 함께 작업이 실패한다. 정확한 오류 문구는 공지에 없다.

## 2. 어디가 걸리기 쉬운가

공지를 읽고 나서 개인적으로 먼저 떠오른 건 "공개 저장소니까 토큰은 필요 없다"고 짜 둔 곳들이다. 예를 들면 이런 것들이다.

- 빌드 스크립트에서 공개 도구 저장소를 `git clone https://github.com/...`로 받는 단계
- Dockerfile 안에서 공개 저장소를 clone하는 `RUN` 명령
- GitHub Actions가 아닌 다른 CI(Jenkins 등)에서 토큰 없이 받는 공개 저장소

반대로 GitHub Actions의 `actions/checkout`은 기본값으로 `${{ github.token }}`을 쓰기 때문에 이미 인증된 상태로 받는다. 같은 워크플로 안에서도 checkout은 괜찮고, 그 뒤에 셸에서 직접 부르는 `git clone`만 비인증인 경우가 흔하다.

## 3. CI에서 인증을 붙이는 방법

공지가 권하는 방법은 환경별로 다르다.

| 환경               | 권장 인증 수단                   |
| ------------------ | -------------------------------- |
| GitHub Actions     | 기본 제공 `GITHUB_TOKEN`         |
| 다른 CI 시스템     | GitHub App 설치 토큰(PAT도 가능) |
| 인증이 불가능한 곳 | 제한이 풀린 뒤 재시도            |

### GitHub Actions

셸에서 직접 clone하던 공개 저장소는 `actions/checkout`의 `repository` 입력으로 옮기는 게 가장 간단하다. 토큰을 따로 넘기지 않아도 기본 토큰으로 받는다.

```yaml
- name: Checkout tools repo
  uses: actions/checkout@v7
  with:
    repository: my-org/my-tools
    path: my-tools
```

### 다른 CI 시스템

GitHub 문서에 따르면 App 설치 토큰은 HTTP 기반 Git 접근에서 비밀번호로 쓸 수 있다. App에는 `Contents` 저장소 권한이 필요하고, 토큰은 1시간 뒤 만료된다.

```bash
git clone https://x-access-token:${TOKEN}@github.com/owner/repo.git
```

만료가 짧은 대신 PAT처럼 사람 계정에 묶이지 않는다. 공지가 PAT보다 App 설치 토큰을 먼저 권하는 이유로 보인다. 토큰을 URL에 넣는 방식은 빌드 로그에 그대로 찍히지 않도록 CI의 비밀값 마스킹을 꼭 켜 둬야 한다.

## 4. 점검할 것

이번 조치는 상시 규칙이 아니라 트래픽 상황에 따라 걸리는 보호 장치다. 그래서 테스트 환경에서 재현하기도 어렵고, 장애가 나도 원인이 바로 보이지 않을 수 있다. 미리 훑어 둘 곳을 정리하면 이렇다.

1. 저장소 전체에서 `git clone https://github.com`, `git fetch` 같은 호출을 검색해 토큰 없이 쓰는 곳을 찾는다.
2. Actions 워크플로라면 셸 clone을 `actions/checkout`으로 옮길 수 있는지 본다.
3. 외부 CI라면 GitHub App을 만들어 설치 토큰을 발급하는 단계를 파이프라인 앞에 둔다.
4. SSH로 받을 수 있는 환경이면 SSH로 바꾸는 것도 방법이다. SSH Git 작업은 영향 대상이 아니다.
5. 빌드가 인증 오류로 실패하면 GitHub Status 페이지를 함께 확인한다.

## 참고 자료

- [Some Git over HTTPS may temporarily require authentication (GitHub Changelog)](https://github.blog/changelog/2026-10-19-some-git-over-https-may-temporarily-require-authentication)
- [Authenticating as a GitHub App installation (GitHub Docs)](https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [actions/checkout README](https://github.com/actions/checkout)
