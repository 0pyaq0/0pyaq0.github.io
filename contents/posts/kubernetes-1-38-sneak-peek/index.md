---
title: "Kubernetes v1.38 미리보기: 업그레이드 전에 노드와 kubelet 설정부터 본다"
description: "12월 16일 예정인 Kubernetes v1.38에서는 kubelet이 cgroup 드라이버를 컨테이너 런타임에서만 받아 오고, kubectl의 WebSocket 끄기 환경 변수가 사라진다. 공식 Sneak Peek 글 기준으로 깨지는 변경과 미리 손볼 곳을 정리했다."
date: 2026-11-26T09:40:00
update: 2026-11-26T09:40:00
tags:
  - Kubernetes
  - DevOps
---

Kubernetes 블로그에 11월 23일 v1.38 Sneak Peek가 올라왔다. 릴리스 예정일은 2026년 12월 16일 수요일이다. 이번 글에서 가장 무거운 항목은 kubelet의 cgroup 드라이버 설정이다. v1.38 kubelet은 기본적으로 예전 방식의 설정을 받지 않고, 컨테이너 런타임이 CRI로 알려 주는 값만 쓴다. 런타임이 이를 지원하지 않으면 kubelet은 노드를 등록하기도 전에 에러로 종료된다. 노드 이미지를 직접 만드는 곳이라면 지금 확인해 둘 일이다.

> v1.38로 올리기 전에 노드, kubectl 스크립트, 웹훅 설정에서 무엇을 바꿔 둬야 할까?

> 이 글은 Kubernetes 공식 블로그의 v1.38 Sneak Peek를 읽고 정리했다. 원문도 릴리스 전까지 내용이 바뀔 수 있다고 적고 있어서, 최종 내용은 v1.38 CHANGELOG로 다시 확인해야 한다.

## 1. 깨지는 변경

### 컨테이너 런타임이 cgroup 드라이버를 알려 줘야 한다

v1.37까지 kubelet은 cgroup 드라이버를 설정 파일의 `cgroupDriver`로도 받을 수 있었다. 최신 방식은 CRI의 `RuntimeConfig` RPC로 런타임이 권장 드라이버를 알려 주는 것이다(KEP-4033). v1.38부터는 예전 방식이 기본으로 막힌다.

| 항목                        | v1.38 동작                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| kubelet `cgroupDriver` 필드 | deprecated, `LegacyCgroupDriverFallback` 게이트 없이는 거부                                    |
| 런타임에서 값을 못 받을 때  | 재시도 후 노드 등록 전에 에러로 종료                                                           |
| 기동 순서                   | 런타임이 kubelet보다 먼저 떠 있어야 함                                                         |
| kubeadm                     | `cgroupDriver`를 `systemd`로 기본 설정하지 않음, 런타임이 RPC를 지원하지 않으면 preflight 에러 |

원문은 지원하는 런타임 버전을 직접 적지 않고, 오래된 런타임은 v1.38 릴리스 노트의 업그레이드 안내를 따르라고만 한다. 지금 노드에 이 필드가 있는지는 kubelet 설정 파일에서 바로 보인다.

```bash
# kubeadm 기본 경로 기준
grep -n "cgroupDriver" /var/lib/kubelet/config.yaml
```

**필드가 있다면 그 노드 이미지는 v1.38 kubelet에서 기동이 거부될 수 있다.** 런타임을 올리고 필드를 지운 이미지로 바꾸는 게 정공법이다.

### LimitedSwap 노드의 스왑 동작

cgroup v2와 `LimitedSwap`을 쓰는 리눅스 노드에서 v1.38 kubelet은 파드 수준 메모리 설정을 기준으로 스왑 한도를 잡는다. 파드 수준 메모리 request와 limit이 같으면 파드와 그 안의 모든 컨테이너가 스왑을 전혀 못 쓴다. 컨테이너 하나가 request를 limit보다 낮게 잡았어도 마찬가지다. 스왑에 기대는 워크로드가 있다면 업그레이드 전에 확인할 부분이다.

## 2. 사라지는 것들

### kubectl WebSocket 끄기 환경 변수

`KUBECTL_REMOTE_COMMAND_WEBSOCKETS`와 `KUBECTL_PORT_FORWARD_WEBSOCKETS`가 v1.38에서 제거된다. kubectl은 v1.30부터 exec, attach, cp에, v1.31부터 port-forward에 WebSocket을 기본으로 써 왔고, 제거 후에는 WebSocket을 먼저 시도하고 필요하면 SPDY로 내려간다. 변수를 남겨 둬도 에러는 나지 않지만 아무 효과가 없다.

```bash
grep -rnE "KUBECTL_(REMOTE_COMMAND|PORT_FORWARD)_WEBSOCKETS" .github/ scripts/ 2>/dev/null
```

### kuberc 허용 목록의 name 필드

kuberc(kubectl 사용자 설정)가 v1.38에서 stable로 올라갈 예정이다. 새 `kubectl.config.k8s.io/v1` API에는 자격 증명 플러그인 허용 목록 항목의 `name` 필드가 없다. 베타 API에서 `name`은 `command`의 별칭이었고 v1.36부터 deprecated였다. 원문 권고는 지금 `command`로 바꿔 두라는 것이다.

## 3. 진행 중인 큰 변화

### cgroup v1

v1.35부터 kubelet은 cgroup v1 노드에서 기동에 실패한다. kubelet 설정에 `failCgroupV1: false`를 넣으면 아직 우회된다. v1.38에서도 이 옵션은 남지만 원문은 단기 처방이라고 못 박았고, 완전 제거는 이후 릴리스로 잡혀 있다(KEP-5573). cgroup 드라이버 변경과 묶어서 노드 이미지를 정리하는 편이 낫다.

### 인증·인가 리뷰 요청이 어드미션 웹훅으로 가지 않는다

`ExcludeAdmissionWebhookVirtualResources` 게이트가 v1.37부터 기본으로 켜져 있다. 그래서 웹훅은 `TokenReview`, `SubjectAccessReview`, `SelfSubjectAccessReview` 같은 리뷰 리소스의 쓰기 요청을 받지 않는다. 이런 리소스를 규칙에 넣은 웹훅 설정은 생성·수정 시 경고가 나온다. 게이트는 지금은 끌 수 있지만 stable이 되면 켜진 상태로 고정될 예정이다.

## 4. stable로 갈 것으로 보이는 기능

| 기능                      | 예상                | KEP      |
| ------------------------- | ------------------- | -------- |
| kuberc                    | beta에서 stable     | KEP-3104 |
| 파드 수준 리소스          | beta에서 stable     | KEP-2837 |
| DRA partitionable devices | stable, 게이트 고정 | KEP-4815 |
| EvictionRequest API       | alpha 유지          | KEP-4563 |

### 점검 목록

- [ ] 노드의 kubelet 설정에 `cgroupDriver`가 남아 있는가
- [ ] 노드 이미지의 컨테이너 런타임이 `RuntimeConfig` RPC를 지원하는 버전인가
- [ ] `failCgroupV1: false`로 버티는 노드가 있는가
- [ ] CI와 스크립트에 kubectl WebSocket 환경 변수가 남아 있는가
- [ ] kuberc 허용 목록이 `name` 대신 `command`를 쓰는가
- [ ] 리뷰 리소스를 규칙에 넣은 어드미션 웹훅이 있는가

## 참고 자료

- [Kubernetes v1.38 Sneak Peek](https://kubernetes.io/blog/2026/11/23/kubernetes-v1-38-sneak-peek/)
- [Kubernetes Blog RSS](https://kubernetes.io/feed.xml)
