---
title: "GitHub package firewall 프리뷰: npm 설치 단계에서 악성 패키지를 막는 구조"
description: "10월 20일 GitHub Enterprise Cloud에 package firewall이 퍼블릭 프리뷰로 나왔다. npm 레지스트리 앞단에서 악성 패키지와 갓 배포된 버전을 막는 방식과 설정, 예외 처리를 공식 문서 기준으로 정리했다."
date: 2026-10-23T09:40:00
update: 2026-10-23T09:40:00
tags:
  - GitHub
  - Security
  - DevOps
---

GitHub가 npm 레지스트리 앞에 두는 package firewall을 10월 20일 퍼블릭 프리뷰로 내놨다. CI 러너나 코딩 에이전트가 `npm install`을 할 때 요청이 이 방화벽을 거치고, 정책에 걸리는 패키지는 설치 단계에서 막힌다. 공지가 짚은 문제는 설치 시점에 실행되는 악성코드다. 사람이 의존성을 들여다보지 않고 설치만 반복하는 에이전트와 CI가 특히 많이 당한다는 것이다. 지금은 npm만 지원하고, GitHub Enterprise Cloud 고객만 쓸 수 있다.

> 레지스트리 앞에 방화벽을 두면 무엇을 기준으로 막고, 막혔을 때는 어떻게 풀어 주나?

> 이 글은 GitHub changelog 공지와 package firewall 설정 문서를 확인해 정리했다. 프리뷰 기능이라 정책 항목과 설정 방식은 바뀔 수 있다.

## 1. 어디에 놓이고 무엇을 검사하나

방화벽은 엔드포인트(개발 PC, CI 호스트, 코딩 에이전트)나 사내 레지스트리와 상위 npm 레지스트리 사이에 선다. 패키지 목록을 묻는 메타데이터 요청과 실제 tarball 다운로드가 모두 여기를 지나고, 엔터프라이즈 정책과 대조된다.

정책은 엔터프라이즈 관리자가 **Policies > Package firewall**에서 정한다. 문서에 나온 항목과 기본값은 이렇다.

| 정책                                   | 내용                                            | 기본값        |
| -------------------------------------- | ----------------------------------------------- | ------------- |
| Block known malware                    | Advisory Database의 악성코드 권고 확인          | 켜짐          |
| Block vulnerability advisories         | 지정한 심각도 이상의 취약점 권고 차단           | Critical only |
| Block attestation downgrades           | 이전 버전엔 있던 SLSA attestation이 빠지면 차단 | 켜짐          |
| Block newly-introduced install scripts | 최근에 설치 스크립트가 추가된 패키지 차단       | 켜짐          |
| Minimum package age                    | 새 버전 사용을 늦추는 유예 기간                 | 1일           |

개인적으로는 아래 세 항목이 더 눈에 들어왔다. 알려진 악성코드 차단은 권고가 등록된 뒤에야 동작한다. 반면 attestation이 갑자기 빠진 버전, 설치 스크립트가 새로 붙은 버전, 막 배포된 버전은 권고가 없어도 걸러진다. Minimum package age는 0(끄기) 또는 1~365일로 정한다.

## 2. npm 설정

요청마다 엔터프라이즈 소속 사용자나 봇 계정의 토큰이 필요하다. 문서는 공개 저장소 읽기 권한 이상은 필요 없다고 적고 있다. 사용자 수준 `.npmrc`에 아래처럼 넣고, `ENTERPRISE`는 엔터프라이즈 slug로 바꾼다.

```text
registry=https://package-firewall.githubapp.com/npm/enterprises/ENTERPRISE
//package-firewall.githubapp.com/npm/enterprises/ENTERPRISE/:_authToken=${GITHUB_TOKEN}
```

명령으로 넣어도 된다.

```bash
npm config set registry \
  https://package-firewall.githubapp.com/npm/enterprises/ENTERPRISE
npm config set \
  '//package-firewall.githubapp.com/npm/enterprises/ENTERPRISE/:_authToken=${GITHUB_TOKEN}'
```

토큰은 CI 비밀값으로 두고 저장소에 커밋하지 말라는 안내가 붙어 있다. Artifactory를 쓰는 조직은 방화벽 URL을 원격 npm 저장소로 등록하고 가상 저장소에 묶는 방식이 실험 기능으로 제공된다. 이때 공개 npm 레지스트리를 직접 바라보는 원격 저장소는 가상 저장소에서 빼야 한다. 그렇지 않으면 방화벽을 우회하는 길이 남는다.

## 3. 막혔을 때의 흐름

차단되면 npm 출력에 이런 형태의 알림이 찍힌다.

```text
npm notice testcontainers: 1 version blocked by package-firewall due to security policies (version cooldown)
```

같이 나오는 URL을 열면 예외 요청 양식이 뜨고, 저장소, 패키지 이름, 버전, 사유가 미리 채워져 있다. 관리자나 보안 담당자가 **Security and quality > Package firewall bypass**에서 승인하면 정책의 Package overrides에 추가된다. 승인할 때 버전을 `*`로 바꾸면 모든 버전을 허용한다.

GitHub도 차단이 잘못될 수 있다고 인정하고 있어서, 예외 흐름이 있다는 게 꽤 중요해 보인다. 다만 **기본값이 켜진 정책이 여럿이라 도입 첫날부터 빌드가 멈출 수 있다.** 특히 Minimum package age 1일은 어제 나온 패치 버전을 오늘 바로 못 받는다는 뜻이다. 급한 보안 패치가 나왔을 때 예외 승인을 누가, 얼마나 빨리 해 줄지는 미리 정해 두는 게 좋다.

## 4. 도입 전에 볼 것

프리뷰 기간에는 무료이고, 정식 출시 후에는 Actions처럼 사용량 기반으로 과금된다고 한다. 정책 편집 권한은 기본적으로 관리자와 보안 담당자에게 있고, 커스텀 역할로 다른 팀에 넘길 수 있다.

- 조직이 GitHub Enterprise Cloud인지
- npm 외 생태계(Maven, PyPI 등)는 아직 대상이 아니라는 점
- CI, 개발 PC, 에이전트 실행 환경 모두 `.npmrc`가 방화벽을 가리키는지
- Artifactory 같은 사내 레지스트리에 공개 npm으로 바로 가는 우회 경로가 없는지
- 유예 기간과 취약점 심각도 기준을 팀 배포 주기에 맞게 조정했는지
- 예외 승인 담당자와 응답 기준이 정해져 있는지

## 참고 자료

- [GitHub package firewall in public preview (GitHub Changelog)](https://github.blog/changelog/2026-10-20-github-package-firewall-in-public-preview)
- [Protecting endpoints with package firewall (GitHub Docs)](https://docs.github.com/enterprise-cloud@latest/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/protecting-endpoints-with-package-firewall)
