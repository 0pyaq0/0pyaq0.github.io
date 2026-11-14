---
title: "GKE 릴리스 노트 11월 둘째 주: 프로브 출발지 IP가 바뀌고 Cloud Storage FUSE가 멈춘다"
description: "GKE Dataplane V2 클러스터에서 kubelet 프로브의 출발지 IP가 169.254.4.6으로 바뀌고, auditd를 켠 노드에서는 Cloud Storage FUSE CSI 마운트가 멈추는 이슈가 공지됐다. 업그레이드 전에 확인할 것을 릴리스 노트 기준으로 정리했다."
date: 2026-11-14T09:40:00
update: 2026-11-14T09:40:00
tags:
  - Kubernetes
  - GCP
  - DevOps
---

GKE 릴리스 노트에 11월 11일과 12일 운영에 직접 걸리는 항목이 몇 개 올라왔다. 가장 조심할 건 Dataplane V2 클러스터의 헬스 체크 출발지 IP 변경이다. GKE 1.35.1-gke.1516000 이상부터 liveness, readiness, startup 프로브가 `169.254.4.6`에서 들어온다. 애플리케이션이나 웹 서버에 IP 허용 목록이 있으면 업그레이드 직후 프로브가 실패해 파드가 재시작되거나 트래픽에서 빠질 수 있다. 여기에 Cloud Storage FUSE CSI 드라이버가 auditd를 켠 노드에서 마운트 중 멈추는 알려진 이슈가 같이 나왔다.

> 다음 GKE 업그레이드 전에 무엇을 바꿔 두고, 무엇을 피해야 할까?

> 이 글은 GKE 릴리스 노트의 11월 11일, 12일 항목을 확인해 정리했다. 연결된 상세 문서는 읽지 못해서, 릴리스 노트에 적힌 범위까지만 다룬다.

## 1. 프로브가 169.254.4.6에서 온다

변경 이유는 CNI 구성이다. Dataplane V2 클러스터가 체인 방식 CNI에서 통합된 cilium-cni 구성으로 바뀌었고, 이제 파드 기본 게이트웨이로 Cilium의 노드 로컬 가상 라우터 인터페이스(`cilium_host`)를 쓴다. 이 인터페이스의 IP가 링크 로컬 주소인 `169.254.4.6`이다.

| 항목                      | 이전                      | 1.35.1-gke.1516000 이상 |
| ------------------------- | ------------------------- | ----------------------- |
| kubelet 프로브 출발지     | 노드 Pod CIDR의 `.1` 주소 | `169.254.4.6`           |
| NodeLocal DNSCache 트래픽 | 노드 Pod CIDR의 `.1` 주소 | `169.254.4.6`           |
| 대상 클러스터             | Dataplane V2              | Dataplane V2            |

릴리스 노트는 애플리케이션 수준 IP 허용 목록이나 웹 서버 ACL이 있다면 **업그레이드 전에 `169.254.4.6/32`를 허용하라**고 적었다. 그렇지 않으면 헬스 체크가 실패할 수 있다고 한다.

개인적으로는 이 부분이 걸렸다. 프로브 엔드포인트에 출발지 제한을 거는 경우가 생각보다 흔하다. nginx에서 `/healthz`를 `allow 10.0.0.0/8; deny all;`로 막아 두거나, Spring Actuator 앞단에 사설 대역만 허용하는 필터를 두는 식이다. `169.254.0.0/16`은 사설 대역 목록에 보통 들어 있지 않다.

### 해당 클러스터 찾기

Dataplane V2를 쓰는지는 `datapathProvider` 값으로 본다. `ADVANCED_DATAPATH`면 Dataplane V2다.

```bash
gcloud container clusters describe CLUSTER_NAME \
  --location LOCATION \
  --format="value(networkConfig.datapathProvider,currentMasterVersion)"

# 노드별 버전 확인
kubectl get nodes -o custom-columns=NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion
```

NetworkPolicy가 이 트래픽을 막는지는 릴리스 노트에 언급이 없었다. 연결된 Dataplane V2 문서를 보고 판단할 부분이다.

## 2. auditd를 켠 노드에서 Cloud Storage FUSE가 멈춘다

11월 11일 이슈로 올라온 내용이다. Linux syscall 감사(auditd)가 켜진 노드, 예를 들어 auditd 로깅을 켠 Container-Optimized OS 노드에서 Cloud Storage FUSE CSI 볼륨 마운트가 무기한 멈출 수 있다. 원인은 드라이버가 Debian 13 베이스 이미지로 바뀌면서 마운트 유틸리티가 새 Linux mount API를 쓰게 된 것이라고 한다.

증상은 이렇게 나타난다.

- 파드가 `Init:0/1`이나 `ContainerCreating`에서 멈춘다
- 지우는 파드가 `Terminating`에 머문다
- 노드 drain이 끝나지 않는다

영향 버전은 1.31부터 1.37까지 라인마다 따로 적혀 있다. 하한선만 정리하면 아래와 같다.

| 라인 | 영향 시작 버전             |
| ---- | -------------------------- |
| 1.33 | `1.33.13-gke.1973000` 이상 |
| 1.34 | `1.34.12-gke.1209000` 이상 |
| 1.35 | `1.35.8-gke.2014000` 이상  |
| 1.36 | `1.36.5-gke.1817000` 이상  |
| 1.37 | `1.37.1-gke.1777000` 이상  |

1.31(`1.31.14-gke.2963000`)과 1.32(`1.32.13-gke.2714000`)도 포함된다. 수정은 진행 중이고 고정 버전은 아직 없다. `gcsfusecsi-node` 파드를 재시작해도 풀리지 않는다. 우회 방법은 auditd 로깅을 끄고 해당 노드를 다시 만드는 것뿐이고, auditd를 꼭 켜야 하면 Cloud Customer Care에 문의하라고 적혀 있다. syscall 감사 규칙이 로드되지 않은 노드는 영향이 없다.

보안 감사 요건 때문에 auditd를 켠 클러스터라면 곤란한 조합이다. 끄는 결정은 보안 팀과 같이 내려야 하니, 그 전까지는 해당 노드 풀의 자동 업그레이드 시점을 확인해 두는 편이 낫다.

## 3. 같이 나온 GA 소식

운영 리스크는 아니지만 같은 주에 나온 것들이다.

- **Capacity buffers GA (11월 11일)**: 컴퓨팅 용량을 미리 확보하고, 원하면 대기 상태로 멈춰 두는 기능이다. `autoscaling.x-k8s.io/v1beta1`의 `CapacityBuffer` 커스텀 리소스로 쓰고, active와 standby 두 종류가 있다. Standard와 Autopilot 모두 1.37.1-gke.3020000 이상에서 쓸 수 있다. 트래픽이 갑자기 몰릴 때 노드 프로비저닝을 기다리는 시간을 줄이려는 용도다.
- **Agent Sandbox GA (11월 12일)**: AI 에이전트처럼 격리된 단일 레플리카 상태 저장 워크로드용 기능이 지원되는 모든 GKE 버전에서 GA가 됐다. 추가 비용은 없다.
- **Rapid 채널 기본 버전 (11월 11일)**: 새 클러스터 기본 버전이 `1.37.1-gke.2097000`이 됐다.

### 점검 목록

- Dataplane V2 클러스터에서 프로브 엔드포인트에 출발지 IP 제한이 있는지 찾는다
- 있다면 업그레이드 전에 `169.254.4.6/32`를 허용 목록에 넣는다
- Cloud Storage FUSE CSI를 쓰는 노드 풀에 auditd가 켜져 있는지 확인한다
- 해당한다면 수정 버전이 나올 때까지 그 노드 풀의 업그레이드 일정을 조율한다

## 참고 자료

- [GKE release notes (Google Cloud)](https://docs.cloud.google.com/kubernetes-engine/docs/release-notes)
- [Google Cloud release notes](https://docs.cloud.google.com/release-notes)
