---
title: "GitHub 비동기 머지 API 정식 출시: 머지 봇이 타임아웃을 기다리지 않아도 된다"
description: "10월 1일 GA가 된 GitHub async merge API를 공식 문서 기준으로 정리했다. 기존 동기 머지 엔드포인트와 무엇이 다르고, 자동화 코드를 어떻게 바꾸면 되는지 적었다."
date: 2026-10-07T19:45:00+09:00
update: 2026-10-07
tags:
  - GitHub
  - DevOps
  - API
---

GitHub가 10월 1일 PR을 비동기로 머지하는 REST API를 정식(GA)으로 열었다. 요청을 던지면 바로 UUID를 돌려받고, 실제 머지는 백그라운드에서 끝난다. 머지 봇이나 배포 파이프라인에서 `PUT .../merge`를 호출하고 응답을 붙잡고 있던 코드라면 한 번 볼 만하다. changelog에서는 이 API를 기존 동기 REST·GraphQL 머지 엔드포인트의 권장 대체재로 소개하고 있다.

## 기존 방식에서 걸리던 부분

지금까지 자동화에서 PR을 머지하는 방법은 보통 `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` 하나였다. 호출하면 그 자리에서 머지를 시도하고 결과를 돌려준다. 단순해서 좋지만 저장소가 바쁠수록 문제가 생긴다.

- 머지가 복잡하면 응답이 늦어지고 타임아웃이 난다.
- 일시적인 실패도 그냥 실패로 떨어져서 재시도 로직을 직접 짜야 한다.
- 머지 큐를 쓰는 저장소에서는 "바로 머지"와 "큐에 넣기"를 따로 처리해야 했다.

새 API는 이 부분을 GitHub 쪽으로 넘긴다. 공식 문서 설명을 그대로 옮기면 백그라운드에서 머지하기 때문에 일부 오류는 재시도될 수 있고, 복잡한 머지에서 타임아웃 위험을 피할 수 있다고 한다.

## 엔드포인트 두 개가 전부다

요청과 조회, 이렇게 두 개다.

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async
GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}
```

PUT 바디에 넣을 수 있는 값은 다음과 같다.

| 파라미터 | 내용 |
| --- | --- |
| `commit_title` | 자동 생성되는 머지 커밋 제목 |
| `commit_message` | 커밋 메시지 뒤에 붙일 내용 |
| `sha` | PR head가 이 SHA와 같을 때만 머지 |
| `merge_method` | `merge`, `squash`, `rebase` |
| `merge_action` | `default`, `direct_merge`, `merge_queue` |

눈여겨본 건 `merge_action`이다. `direct_merge`는 머지 큐를 거치지 않고 바로 머지하고, `merge_queue`는 큐에 넣는다. `default`는 GitHub가 상황에 맞는 쪽을 고른다. 머지 큐 도입 여부에 따라 봇 코드를 둘로 나눌 필요가 없어진 셈이다.

`sha`도 동작이 조금 다르다. 값을 안 넣으면 요청 시점의 PR head를 기준으로 잡는데, 요청과 실제 실행 사이에 누가 push를 하면 머지가 취소된다. 리뷰가 끝난 커밋만 머지되도록 하는 장치로 쓸 수 있다.

## 응답과 상태 코드

PUT이 새 요청을 받아들이면 202와 함께 이런 응답이 온다.

```json
{
  "status": "pending",
  "details": {
    "message": "string",
    "uuid": "string",
    "merge_method": "squash",
    "merge_action": "default",
    "expected_head_sha": "string"
  }
}
```

`status`는 `pending`, `merged`, `enqueued`, `failed` 넷 중 하나다. GET으로 조회해도 같은 모양이 온다. 상태 코드는 동기 API보다 경우가 많다.

| 코드 | 의미 |
| --- | --- |
| 200 | 이미 머지됐거나 큐에 들어가 있음 |
| 202 | 새 요청 접수, 백그라운드 처리 |
| 400 | 닫혔거나 draft라서 머지 불가 |
| 409 | 이미 진행 중인 비동기 머지 요청이 있음 (기존 UUID 반환) |
| 422 | 검증 실패 |

409가 오류가 아니라 "이미 있다"는 뜻이라는 점이 재미있다. 같은 PR에 머지 요청을 두 번 보내도 기존 UUID를 돌려받으니, 봇이 재시작되면서 요청을 중복으로 보내도 크게 문제 될 게 없다. 그리고 결과는 마지막 업데이트 후 24시간만 보관된다. 하루 넘게 지난 UUID로 조회하면 404가 온다.

## 스택 PR은 이 API로만 머지된다

이번 발표에서 가장 큰 변화는 사실 여기다. 문서에는 스택으로 쌓인 PR을 머지할 때는 이 엔드포인트가 필수라고 적혀 있다. 스택의 중간 PR을 지정하면 그 아래 PR부터 지정한 PR까지 전부 base 브랜치로 머지된다. 기존 `/merge`로는 이걸 못 한다.

스택 PR을 쓰는 팀이라면 머지 자동화를 이쪽으로 옮겨야 한다는 뜻이고, 아직 안 쓰는 팀이라도 나중에 스택 PR을 도입할 때 봇을 다시 고칠 필요가 없도록 지금 넘어가 두는 게 편해 보인다.

## 자동화 코드는 이렇게 바뀐다

curl로 흐름만 보면 이렇다.

```bash
# 1. 머지 요청
curl -s -X PUT \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  https://api.github.com/repos/OWNER/REPO/pulls/123/merge-async \
  -d '{"merge_method":"squash","sha":"<리뷰한 head SHA>"}'

# 2. 응답의 details.uuid로 상태 조회
curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  https://api.github.com/repos/OWNER/REPO/pulls/123/merge-async/$UUID
```

옮길 때 신경 쓸 부분은 몇 가지다.

- 응답을 받았다고 머지가 끝난 게 아니다. `status`가 `merged`나 `enqueued`가 될 때까지 조회하고, `failed`면 `details.message`를 로그에 남긴다.
- 폴링 간격은 넉넉하게 잡는다. 동기 API 문서에도 너무 빠르게 호출하면 secondary rate limit에 걸릴 수 있다고 적혀 있다.
- 409를 실패로 처리하던 기존 에러 핸들링이 있다면 고친다. 비동기 API에서는 진행 중인 요청의 UUID를 받는 정상 경로다.
- 리뷰한 커밋만 머지하고 싶다면 `sha`를 꼭 넣는다.

changelog에는 적절한 권한이 있으면 머지 규칙을 우회하는 옵션도 있다고 나오는데, 이건 자동화에 기본으로 켜 둘 기능은 아니라고 본다. 우회가 필요한 봇이라면 토큰 권한부터 따로 관리하는 게 맞다.

## 참고 자료

- [GitHub async merge API generally available (GitHub Changelog)](https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/)
- [REST API endpoints for pull requests: Merge a pull request asynchronously (GitHub Docs)](https://docs.github.com/rest/pulls/pulls?apiVersion=2026-03-10#merge-a-pull-request-asynchronously)
