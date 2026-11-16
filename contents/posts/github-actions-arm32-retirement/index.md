---
title: "GitHub Actions ARM32 지원 종료: 12월 8일 전에 32비트 ARM 잡을 찾아 두자"
description: "GitHub Actions가 12월 8일까지 Windows와 Linux의 ARM32 잡 실행 지원을 끝낸다. Node 20 제거에서 이어진 변경이라, 두 공지를 함께 읽고 영향 범위와 확인 방법을 정리했다."
date: 2026-11-16T09:40:00
update: 2026-11-16T09:40:00
tags:
  - GitHub
  - DevOps
---

GitHub이 11월 12일 changelog에서 Actions의 ARM32 지원 종료를 공지했다. Windows와 Linux에서 ARM32 잡 실행 지원이 2026년 12월 8일까지 끝난다. 이유는 한 줄이다. Node 20 지원이 이미 끝났고, 그 자리를 채운 Node 24가 ARM32를 지원하지 않는다. 라즈베리 파이 같은 32비트 ARM 보드를 self-hosted runner로 붙여 펌웨어 빌드나 장비 테스트를 돌리고 있다면, 남은 시간은 3주 남짓이다.

> 우리 워크플로 중 ARM32에서 도는 것이 있는지, 어떻게 찾고 무엇으로 옮겨야 할까?

> 이 글은 GitHub changelog의 ARM32 지원 종료 공지와 Node 20 제거 공지를 확인해 정리했다. 공지 본문이 짧아서, 적혀 있지 않은 세부 동작은 추측하지 않았다.

## 1. 공지에 적힌 내용

본문은 세 문장이 전부다.

| 항목      | 내용                                        |
| --------- | ------------------------------------------- |
| 대상      | Windows와 Linux의 ARM32 잡 실행             |
| 시점      | 2026년 12월 8일까지                         |
| 이유      | Node 24가 ARM32를 지원하지 않음             |
| 추가 사항 | 네이티브 AArch32 유저 공간 실행 지원도 제거 |

마지막 줄이 눈에 띈다. 호스티드 러너에서 네이티브 AArch32 유저 공간 실행 지원을 뺀다는 뜻이다. 64비트 ARM 러너 위에서 32비트 ARM 바이너리를 그대로 돌리던 방식도 막힌다고 읽힌다.

공지에는 단계적 중단(brownout) 일정, 남는 self-hosted runner가 날짜 이후 어떻게 되는지, 마지막 지원 러너 버전 같은 정보가 없었다. 12월 8일 하나만 기준으로 잡으면 된다.

## 2. 뿌리는 Node 20 제거다

이 공지는 9월 23일 나온 Node 20 제거 공지와 이어진다. 그 공지를 다시 보니 이미 이렇게 적혀 있었다.

- 러너는 이제 JavaScript 액션을 Node 24로 실행한다
- 임시 예외였던 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`은 더는 쓸 수 없다
- Node 24는 macOS 13.4 이하와 호환되지 않고 ARM32를 공식 지원하지 않는다
- 그래서 이런 OS나 아키텍처의 self-hosted runner는 지원 대상이 아니다

**self-hosted ARM32 러너는 9월부터 이미 지원 밖이었던 셈이다.** 이번 공지는 남아 있던 실행 경로까지 정리하는 마무리에 가깝다. 개인적으로는 JavaScript 액션 대부분이 Node 런타임에 기대고 있다는 점이 더 걸렸다. `actions/checkout`처럼 흔한 액션도 JavaScript 액션이라, 러너가 Node 24를 못 돌리면 첫 단계부터 막힌다.

## 3. 영향받는 잡 찾기

워크플로 파일만 봐서는 잘 안 보인다. `runs-on`에 self-hosted 레이블을 쓰면 실제 아키텍처는 러너에 달려 있기 때문이다. 러너가 실제로 어떤 아키텍처인지는 `runner.arch` 컨텍스트로 확인할 수 있다. 값은 `X86`, `X64`, `ARM`, `ARM64` 중 하나이고, 32비트 ARM이면 `ARM`이다.

```yaml
jobs:
  arch-check:
    runs-on: [self-hosted, linux]
    steps:
      - name: 러너 아키텍처 출력
        run: |
          echo "runner.arch=${{ runner.arch }}"
          uname -m
```

`uname -m`이 `armv7l`이나 `armv6l`을 찍으면 32비트 ARM이다. 조직에 러너가 많다면 레이블에 `arm`이 붙은 러너부터 위 잡을 한 번씩 돌려 보는 게 빠르다.

## 4. 옮길 곳

공지는 이전 방법을 따로 안내하지 않는다. 그래서 선택지는 상식선에서 갈린다.

- 장비가 64비트 OS를 돌릴 수 있으면 ARM64 OS로 다시 올리고 64비트 러너를 설치한다
- 빌드 산출물만 ARM32용이면 64비트 러너에서 크로스 컴파일로 바꾼다
- 실제 32비트 장비에서 테스트해야 한다면 Actions 밖에서 그 장비를 원격으로 호출하는 구조를 검토한다

어느 쪽이든 직접 만든 JavaScript 액션이 있다면 `action.yml`의 `runs.using`을 `node24`로 올리고 새 릴리스를 내야 한다. Node 20 공지가 메인테이너에게 요구한 조치 그대로다.

### 점검 목록

- self-hosted 러너마다 `runner.arch`가 `ARM`인 곳이 있는지 확인한다
- 사내 JavaScript 액션의 `runs.using` 값이 `node24`인지 본다
- 같은 이유로 지원 밖인 macOS 13.4 이하 self-hosted 러너도 함께 정리한다
- 12월 8일 전에 ARM32 잡을 옮기거나 끄는 일정을 잡는다

## 참고 자료

- [Actions for ARM32 Linux & Windows retirement (GitHub Changelog)](https://github.blog/changelog/2026-11-12-actions-for-arm32-linux-windows-retirement)
- [Node 20 is no longer available in GitHub Actions (GitHub Changelog)](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/)
