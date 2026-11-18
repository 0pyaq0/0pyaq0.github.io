---
title: "kube-proxy IPVS 모드 1.40부터 꺼진다: nftables로 옮길 때 확인할 것"
description: "Kubernetes SIG Network가 kube-proxy IPVS 백엔드를 1.40에서 제거하겠다고 발표했다. 언제까지 무엇으로 옮겨야 하는지, 공식 블로그 기준으로 정리했다."
date: 2026-11-18T09:40:00
update: 2026-11-18T09:40:00
tags:
  - Kubernetes
  - DevOps
---

11월 16일 Kubernetes 블로그에 kube-proxy IPVS 백엔드 제거 일정이 올라왔다. SIG Network가 1.35에서 IPVS 모드를 공식 지원 중단(deprecated)했고, 이제 **Kubernetes 1.40에서 제거할 계획**이라고 밝혔다. 지금은 경고만 찍히고 동작은 하지만, KEP를 보니 1.40부터는 기본 설정으로 IPVS 모드를 켜면 kube-proxy가 오류로 종료된다. 클러스터를 처음 만들 때 "IPVS가 iptables보다 빠르다"는 이유로 `mode: ipvs`를 고른 팀이 꽤 있었을 텐데, 그 설정을 바꿀 시점이 정해진 셈이다.

> IPVS를 쓰고 있다면 무엇으로, 어떤 순서로 옮겨야 할까?

> 이 글은 Kubernetes 공식 블로그의 IPVS 제거 공지와 KEP-5495를 확인해 정리했다. 단계별 버전은 KEP 기준이고, 일정은 바뀔 수 있다.

## 1. 왜 IPVS를 없애나

공지가 든 이유는 기능 정합성이다. IPVS 백엔드는 Kubernetes Service 동작의 엣지 케이스를 끝까지 정확하게 구현하지 못했다고 한다. 그리고 nftables 백엔드가 결국 iptables와 IPVS를 모두 대체할 것이라고 적었다.

성능을 이유로 IPVS를 골랐다면 공지의 다른 문장이 걸린다. kube-proxy가 IPVS를 쓰는 방식 때문에 IPVS 스케줄러 대부분을 쓸모 있게 활용하지 못했다고 한다. 결국 iptables, nftables처럼 엔드포인트를 무작위로 고르는 것과 큰 차이가 없었다는 뜻으로 읽힌다. 성능도 nftables가 IPVS보다 "아주 조금" 낫다고 적혀 있다.

또 하나는 배포판 쪽 사정이다. Red Hat이 RHEL에서 iptables API를 없앨 계획이라, 그 환경에서는 IPVS 백엔드도 더는 쓸 수 없게 된다고 한다.

## 2. 단계별 일정

블로그는 "1.40에서 제거"라고 썼지만, KEP-5495는 단계를 더 잘게 나눴다. 기능 게이트(feature gate)로 끄고, 코드는 나중에 지운다.

| 단계 | 버전 | 내용                                           |
| ---- | ---- | ---------------------------------------------- |
| 1    | 1.35 | IPVS 모드로 시작하면 경고 로그                 |
| 3    | 1.40 | 게이트 기본값 `false`, 그대로 두면 오류로 종료 |
| 4    | 1.43 | 게이트 고정, `pkg/proxy/ipvs` 코드 삭제        |
| 정리 | 1.46 | 기능 게이트 자체 삭제                          |

1.40에서도 게이트를 직접 켜면 IPVS를 계속 쓸 수 있다는 뜻이다. 하지만 1.43에서 코드가 빠지니 시간을 버는 정도로 보는 게 맞다. KEP는 IPVS 관련 CLI·설정 옵션을 경고만 내는 no-op으로 남기는 방향도 적었다.

## 3. 어디로 옮기나

공지의 권장은 조건에 따라 갈린다.

| 조건                                 | 권장 모드       | 비고                  |
| ------------------------------------ | --------------- | --------------------- |
| Kubernetes 1.36 이상, 커널 5.13 이상 | `nftables`      | 1순위                 |
| 1.33~1.35                            | `nftables` 가능 | 1.36 성능 수정 미포함 |
| 더 오래된 버전이나 커널              | `iptables`      | 대안                  |

nftables 백엔드는 1.33에서 GA가 됐다. 다만 성능과 확장성 관련 수정 일부가 1.36 이전 버전에는 백포트되지 않았다. 그래서 공지는 1.36 이상, 커널 5.13 이상 노드에서 nftables로 옮기라고 권한다. 조건이 안 맞으면 iptables도 괜찮다고 했다. 2026년의 iptables 백엔드는 2017년보다 훨씬 낫다는 표현을 썼다.

개인적으로는 1.36과 커널 5.13이라는 두 조건을 같이 봐야 한다는 점이 걸렸다. 컨트롤 플레인 버전만 올리고 노드 OS 이미지가 오래된 클러스터라면 nftables로 바로 못 간다.

## 4. 바꾸는 방법

kubeadm 클러스터라면 kube-proxy ConfigMap에서 `mode: ipvs`를 `mode: nftables`로 바꾸고 kube-proxy 파드를 재시작한다. IPVS 전용 옵션을 쓰고 있었다면 대응하는 nftables 옵션으로 옮긴다.

먼저 지금 모드를 확인한다. 아래 두 방법은 공지가 아니라 kube-proxy 설정과 상태를 직접 보는 일반적인 방법이다.

```bash
# ConfigMap에 설정된 모드
kubectl -n kube-system get configmap kube-proxy -o yaml | grep -E '^\s*mode:'

# 노드에서 kube-proxy가 실제로 쓰는 모드
curl -s http://localhost:10249/proxyMode
```

ConfigMap을 고친 뒤에는 공지에서 한 가지를 더 권한다. **kube-proxy만 재시작하지 말고 노드를 하나씩 재부팅하라**는 것이다. IPVS가 남긴 커널 상태를 깨끗이 정리하려는 의도로 보인다. 노드를 비우고(drain) 재부팅하는 롤링 작업으로 계획하는 편이 안전하다.

관리형 Kubernetes는 공지에서 다루지 않았다. EKS, GKE, AKS에서 kube-proxy 모드를 직접 바꿔 쓰고 있다면 각 서비스 문서에서 nftables 지원 여부를 따로 확인해야 한다.

### 점검 목록

- 클러스터마다 kube-proxy 모드가 `ipvs`인지 확인한다
- 노드 커널이 5.13 이상인지, 클러스터가 1.36 이상인지 본다
- IPVS 전용 kube-proxy 옵션을 쓰고 있다면 nftables 대응 옵션을 찾는다
- 모드 변경 후 노드 롤링 재부팅 일정을 잡는다
- 1.40 업그레이드 전에 전환을 끝낸다(게이트로 버티는 건 1.43까지)

## 참고 자료

- [Scheduling the removal of the kube-proxy IPVS backend (Kubernetes Blog)](https://kubernetes.io/blog/2026/11/16/ipvs-removal/)
- [KEP-5495: Deprecate IPVS mode in kube-proxy](https://github.com/kubernetes/enhancements/blob/master/keps/sig-network/5495-deprecate-ipvs-mode-in-kube-proxy/README.md)
