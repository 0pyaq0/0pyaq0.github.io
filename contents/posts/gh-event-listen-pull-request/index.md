---
title: "gh event listen: PR 리뷰와 CI 완료를 폴링 없이 기다린다"
description: "GitHub CLI 2.105.0에 gh event listen이 들어왔다. Event Streams 프리뷰 위에서 PR 이벤트를 한 번의 명령으로 기다리는 방식, 이벤트 종류, 종료 코드, 놓치기 쉬운 제약을 공식 changelog와 gh 매뉴얼 기준으로 정리했다."
date: 2026-11-22T09:40:00
update: 2026-11-22T09:40:00
tags:
  - GitHub
  - DevOps
---

PR에 리뷰가 달리거나 CI가 끝나기를 스크립트에서 기다릴 때 보통은 `gh pr view`나 `gh pr checks`를 `sleep`과 같이 돌린다. 11월 18일 GitHub CLI changelog에 이 루프를 명령 하나로 바꾸는 `gh event listen`이 올라왔다. PR URL과 기다릴 이벤트를 주면 이벤트가 올 때까지 블록하고, 기본값으로 첫 이벤트를 받으면 바로 끝난다. 스크립트나 에이전트 루프에 끼워 넣기 좋은 형태다. 다만 아직 프리뷰이고, 쓰려면 Event Streams 프리뷰 접근 권한이 따로 필요하다.

> PR 상태를 기다리는 폴링 루프를 `gh event listen`으로 바꾸면 무엇이 달라지고, 무엇을 조심해야 할까?

> 이 글은 GitHub changelog와 `gh event`, `gh event listen` 매뉴얼을 읽고 정리했다. `gh event` 명령은 프리뷰라서 플래그나 이벤트 이름이 바뀔 수 있다.

## 1. 쓰기 위한 조건

| 항목      | 조건                                                 |
| --------- | ---------------------------------------------------- |
| gh 버전   | `v2.105.0` 이상                                      |
| 서버      | github.com만 지원, GHES와 GHE.com은 미지원           |
| 접근 권한 | Event Streams 프리뷰 대기 목록 등록 후 활성화된 계정 |
| 대상      | 현재는 pull request만                                |

개인적으로는 세 번째 줄이 가장 걸렸다. CLI를 올려도 계정이 Event Streams에 활성화되어 있지 않으면 쓸 수 없다. 팀 CI 스크립트에 바로 넣기보다는 먼저 계정 상태부터 확인해야 하는 셈이다.

같은 릴리스에서 `gh pr create`, `gh pr view`, `gh run view`, `gh run watch`, `gh api`가 폴링 대신 `gh event listen`을 쓰라고 안내하도록 바뀌었다고 한다. 에이전트가 이 안내를 보고 명령을 고르게 하려는 의도로 보인다.

## 2. 기다릴 수 있는 이벤트

매뉴얼에 적힌 이벤트 타입은 다섯 개다.

| 이벤트 타입                                             | 발생 시점                                        |
| ------------------------------------------------------- | ------------------------------------------------ |
| `com.github.pull_request.review.submitted.v1`           | 리뷰가 제출됨                                    |
| `com.github.pull_request.state.changed.v1`              | 머지, 닫힘, 재오픈, ready for review, draft 전환 |
| `com.github.pull_request.head.changed.v1`               | head 브랜치가 바뀜(푸시 등)                      |
| `com.github.pull_request.merge_conflict.v1`             | 머지 충돌 발생                                   |
| `com.github.pull_request.check_suite.status.changed.v1` | head 커밋의 check suite 하나가 완료됨            |

출력은 이벤트 하나당 한 줄짜리 CloudEvent JSON이고 stdout으로 나온다. 상태 메시지는 stderr로 가니 stdout을 그대로 `jq`에 넘겨도 된다. 이벤트 본문은 얇아서 `data.api_url`이 바뀐 객체를 가리키는 정도다. 자세한 내용은 그 URL을 다시 조회해야 한다.

## 3. 명령 모양

자주 쓸 만한 예시를 매뉴얼에서 골랐다.

```bash
# 다음 리뷰를 최대 30분 기다린다
gh event listen \
  --resource https://github.com/OWNER/REPO/pull/123 \
  --event com.github.pull_request.review.submitted.v1 \
  --timeout 30m

# 다음 check suite 완료를 기다리고 결론만 출력한다
gh event listen \
  --resource https://github.com/OWNER/REPO/pull/123 \
  --event com.github.pull_request.check_suite.status.changed.v1 \
  --jq .data.conclusion
```

플래그는 많지 않다. `--event`는 반복하거나 쉼표로 여러 개를 줄 수 있다. `--count`로 받을 이벤트 수를 정하고, `--follow`를 주면 멈출 때까지 계속 듣는다. `--timeout`은 초나 `30s`, `10m` 같은 duration을 받고, **시간이 먼저 다 되면 종료 코드 8로 끝난다**. 스크립트에서는 이 값을 따로 처리해 두면 된다.

```bash
gh event listen --resource "$PR_URL" \
  --event com.github.pull_request.state.changed.v1 --timeout 1h
status=$?
if [ "$status" -eq 8 ]; then
  echo "1시간 안에 상태 변화 없음" >&2
fi
```

## 4. 폴링을 그대로 대체하지 못하는 부분

매뉴얼을 읽어 보니 "이벤트를 받았다"와 "원하는 상태가 됐다"가 같지 않은 경우가 꽤 있다.

### check suite는 하나씩 온다

check suite 이벤트는 suite마다 따로 온다. 워크플로가 여러 개면 첫 이벤트는 그중 하나가 끝났다는 뜻일 뿐이다. 매뉴얼도 이벤트를 받을 때마다 `gh pr checks` 같은 명령으로 전체 체크를 다시 읽으라고 안내한다.

```bash
while gh event listen --resource "$PR_URL" \
  --event com.github.pull_request.check_suite.status.changed.v1 --timeout 20m >/dev/null; do
  gh pr checks "$PR_URL" && break
done
```

`gh pr checks`는 실패나 대기 중인 체크가 있으면 0이 아닌 값으로 끝나니, 모두 통과했을 때 루프를 빠져나온다.

### 지난 이벤트는 다시 주지 않는다

리스너가 붙기 전에 일어난 변화는 보고되지 않는다. 그래서 매뉴얼은 듣기 시작한 다음 리소스를 한 번 읽으라고 한다. 순서를 거꾸로 하면 그 사이에 끝난 CI를 영영 기다리게 된다. 스트림이 끊기면 다시 연결하지만, 끊긴 동안의 이벤트도 전달되지 않는다.

### 구독에는 수명과 개수 제한이 있다

명령은 내부적으로 리소스와 이벤트 타입에 대한 구독을 만들거나 기존 것을 재사용한다. 구독은 24시간 뒤 만료되고 계정당 동시에 가질 수 있는 수가 제한된다. 정확한 개수는 매뉴얼에 없었다. 구독은 `gh event subscription create`, `list`, `view`, `delete`로 직접 관리할 수도 있다.

### 점검 목록

- [ ] 계정이 Event Streams 프리뷰에 활성화되어 있는가
- [ ] gh가 `v2.105.0` 이상인가
- [ ] 종료 코드 8(타임아웃)을 따로 처리하는가
- [ ] 듣기 시작한 뒤 PR 상태를 한 번 다시 읽는가
- [ ] check suite 이벤트 뒤에 전체 체크를 다시 확인하는가

## 참고 자료

- [Wait for pull request events with GitHub CLI](https://github.blog/changelog/2026-11-18-wait-for-pull-request-events-with-github-cli)
- [gh event 매뉴얼](https://cli.github.com/manual/gh_event)
- [gh event listen 매뉴얼](https://cli.github.com/manual/gh_event_listen)
