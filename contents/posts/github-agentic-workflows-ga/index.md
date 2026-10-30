---
title: "GitHub Agentic Workflows 정식 출시: Actions 안에서 에이전트를 돌릴 때의 보안 구조"
description: "10월 28일 GitHub Agentic Workflows가 정식 출시됐다. 자연어 Markdown을 Actions 워크플로로 컴파일하는 방식과, 에이전트에게 쓰기 권한을 주지 않는 safe outputs, 네트워크 방화벽, 위협 탐지 구조를 공식 문서 기준으로 정리했다."
date: 2026-10-30T09:40:00
update: 2026-10-30T09:40:00
tags:
  - GitHub
  - AI
  - DevOps
---

GitHub Agentic Workflows가 10월 28일 정식 출시(GA)됐다. 이슈 분류, CI 실패 분석, 문서 갱신, 테스트 작성 같은 일을 코딩 에이전트에게 맡기는데, 그 에이전트가 GitHub Actions 안에서 돈다. 자동화 내용은 자연어 Markdown으로 쓰고, CLI가 이를 일반 Actions YAML로 컴파일한다. 개인적으로 눈여겨본 건 기능보다 구조다. **에이전트는 읽기 전용으로 돌고, 실제 쓰기는 별도 job이 검증을 거쳐 대신한다.** 저장소에 에이전트를 붙이면서 가장 걱정되는 프롬프트 인젝션과 과한 권한 문제를 설계로 막으려는 시도다.

> 에이전트를 CI에 넣을 때 권한과 네트워크는 어떻게 묶여 있나?

> 이 글은 GitHub changelog의 GA 공지와 gh-aw 공식 문서(빠른 시작, 아키텍처, safe outputs)를 확인해 정리했다.

## 1. 어떻게 동작하나

워크플로는 `.github/workflows/` 아래에 `.md` 파일로 둔다. 위쪽 frontmatter에 트리거와 권한, 사용할 엔진 같은 설정을 쓰고, 본문에는 에이전트에게 시킬 일을 자연어로 적는다. `gh aw compile`을 돌리면 `.lock.yml` 파일이 생기고, Actions가 실제로 실행하는 건 이 파일이다. 평범한 Actions 워크플로라서 기존 러너 그룹과 정책 제약을 그대로 쓴다.

```bash
gh extension install github/gh-aw
gh aw compile
gh aw run daily-repo-status
```

엔진은 Copilot CLI가 기본이고 Claude Code, Codex 같은 다른 에이전트도 고를 수 있다. 엔진에 따라 `COPILOT_GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` 중 하나를 시크릿으로 넣는다.

Free, Team, Enterprise 플랜의 github.com에서 쓸 수 있고, 기본 엔진인 Copilot CLI를 쓰려면 Copilot 라이선스가 필요하다.

## 2. 보안 구조

아키텍처 문서를 보니 한 번의 실행이 여러 job으로 쪼개져 있다.

| 단계            | 권한          | 하는 일                                     |
| --------------- | ------------- | ------------------------------------------- |
| 에이전트 job    | 읽기 전용     | 저장소를 읽고 결과를 구조화된 출력으로 남김 |
| 위협 탐지 job   | 쓰기 없음     | 출력과 패치에서 비밀값 유출, 악성 변경 검사 |
| safe output job | 필요한 쓰기만 | 검사를 통과한 요청만 실제로 실행            |

### safe outputs

에이전트가 이슈를 만들고 싶으면 직접 만들지 않고 "이슈를 만들어 달라"는 출력을 남긴다. 그러면 `issues: write` 권한을 가진 별도 job이 그걸 실행한다. 에이전트가 오염돼도 저장소를 직접 바꿀 길이 없다는 게 문서의 설명이다.

쓸 수 있는 출력 유형은 `create-issue`, `add-comment`, `create-pull-request`, `add-labels`부터 `create-code-scanning-alert`까지 꽤 많다. 유형마다 한 번 실행에서 할 수 있는 횟수 상한(`max`)이 있고, 기본값은 `create-issue` 1회, `add-labels` 3회 같은 식이다. `safe-outputs:`를 아예 안 쓰면 `create-issue`가 `max: 1`로 자동으로 켜진다는 점은 알아 둘 만하다.

### 네트워크 방화벽

에이전트는 샌드박스 컨테이너에서 Agent Workflow Firewall 뒤에 놓인다. frontmatter의 `network:`에서 `firewall: true`를 켜고 `allowed:`에 허용할 도메인을 적는다. `defaults`, `python`, `node` 같은 생태계 묶음이나 개별 도메인을 넣을 수 있고, 목록에 없는 도메인으로 가는 요청은 Squid 프록시에서 버려진다.

### 위협 탐지와 integrity 필터

위협 탐지 job은 쓰기 권한 없이 에이전트 출력과 패치를 AI로 분석하고, 이 판정이 safe output job의 실행 여부를 가른다. `threat-detection.steps`로 외부 스캐너를 붙일 수도 있다.

integrity 필터는 에이전트가 읽는 내용 자체를 거른다. `min-integrity`를 `merged`, `approved`, `unapproved`, `none` 중 하나로 정하는데, 공개 저장소에서는 `approved`가 자동으로 걸려 소유자, 멤버, 협업자가 쓴 내용만 에이전트에게 간다.

## 3. 설정 예시

문서에 나온 키로 frontmatter를 짜 보면 대략 이런 모양이다.

```yaml
---
engine: claude
permissions:
  contents: read
  issues: read
network:
  firewall: true
  allowed:
    - defaults
safe-outputs:
  create-issue:
    max: 1
---
```

본문에는 "최근 저장소 활동을 요약해 상태 보고 이슈를 만들어라" 같은 지시를 자연어로 쓴다. GitHub Next의 `githubnext/agentics` 저장소에 분류, 의존성 관리, 코드 리뷰, 리포트용 예제 워크플로가 모여 있으니 처음엔 거기서 가져와 고치는 편이 빠르다.

## 4. GA에서 추가된 것과 도입 전 점검

GA와 함께 self-hosted ARC 러너의 Docker-in-Docker 지원, 비용 예측 명령 `gh aw forecast`의 정식화, Cloud Hypervisor 같은 마이크로 VM 격리가 들어갔다.

아키텍처 문서에는 솔직한 경고도 하나 있다. MCP 게이트웨이의 API 키가 에이전트 컨테이너에 마운트되는데, 이건 강한 보안 경계가 아니니 노출됐다고 보고 격리와 네트워크 정책, 권한 분리에 기대라는 것이다.

- `safe-outputs:`를 명시해 자동으로 켜지는 `create-issue`까지 의도한 것인지 확인했는지
- `network.allowed`를 필요한 도메인으로만 좁혔는지
- 공개 저장소가 아닌데 외부 기여가 들어오는 곳이라면 `min-integrity`를 따로 정했는지
- `gh aw forecast`로 AI 크레딧 비용 범위를 미리 봤는지
- 생성된 `.lock.yml`도 리뷰 대상에 넣었는지

## 참고 자료

- [GitHub Agentic Workflows generally available (GitHub Changelog)](https://github.blog/changelog/2026-10-28-github-agentic-workflows-generally-available)
- [Quick Start (gh-aw 문서)](https://github.github.com/gh-aw/setup/quick-start/)
- [Architecture (gh-aw 문서)](https://github.github.com/gh-aw/introduction/architecture/)
- [Safe Outputs (gh-aw 문서)](https://github.github.com/gh-aw/reference/safe-outputs/)
