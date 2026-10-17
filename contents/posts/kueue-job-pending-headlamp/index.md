---
title: "Kueue 환경에서 Job이 Pending일 때: 스케줄링보다 admission을 먼저 본다"
description: "Kubernetes 블로그에 소개된 Kueue admission 추적 글과 Headlamp Kueue 플러그인을 바탕으로, Kueue를 쓰는 클러스터에서 Job이 시작되지 않을 때 어디부터 확인하면 되는지 정리했다."
date: 2026-10-17T09:40:00
update: 2026-10-17T09:40:00
tags:
  - Kubernetes
  - DevOps
---

Kueue를 쓰는 클러스터에서 Job을 올렸는데 Pod가 하나도 안 생기는 경우가 있다. Job은 suspend 상태로 멈춰 있고, 애플리케이션 로그도 없고, 들여다볼 Pod조차 없다. 10월 14일 Kubernetes 블로그에 소개된 Headlamp 팀의 글은 이럴 때 "Pod가 왜 Pending이지?"보다 **"Kueue가 이 Workload를 admit했나?"를 먼저 물어야 한다**고 정리한다. 같이 공개된 Headlamp Kueue 플러그인은 이 추적 과정을 화면에서 따라가게 해 준다.

> Kueue가 관리하는 Job이 시작되지 않을 때, 어떤 순서로 무엇을 확인하면 원인을 찾을 수 있나?

> 이 글은 Kubernetes 블로그에 실린 "Why Is My Kubernetes Job Still Pending? Tracing Kueue Admission with Headlamp"(원문은 headlamp.dev)를 읽고 정리했다. 플러그인은 0.1.0-alpha 버전이라 화면과 기능은 바뀔 수 있다.

## 1. 단계가 두 개라는 것부터

Kueue가 있는 클러스터에서 Job이 실행되기까지는 두 단계를 거친다.

| 단계            | 판단 주체      | 보는 것                                            |
| --------------- | -------------- | -------------------------------------------------- |
| Kueue admission | Kueue          | 큐 정책, 쿼터, ResourceFlavor, 대기 중인 다른 작업 |
| Pod 스케줄링    | kube-scheduler | 노드에 Pod를 올릴 수 있는지                        |

첫 단계를 통과하지 못하면 Job은 suspend 상태로 남고 Pod는 아예 만들어지지 않는다. 이 상황에서 노드 리소스나 스케줄러 로그를 뒤지면 아무것도 안 나온다. 글에서 강조하는 지점이 여기다. Pod가 없는 건 고장이 아니라 Kueue가 아직 결정을 내리지 않았다는 뜻일 수 있다.

## 2. 알아 둘 Kueue 객체

추적하려면 객체 관계를 알아야 한다. 글의 설명을 옮기면 이렇다.

- **Workload**: Job의 리소스 요청과 admission 상태를 나타낸다. 이름에 보통 Job 이름이 들어간다.
- **LocalQueue**: Job이 쓰는 네임스페이스 단위 입구. 네임스페이스의 Workload를 ClusterQueue로 연결한다.
- **ClusterQueue**: 클러스터 범위의 쿼터와 admission 정책을 가진다. 여러 LocalQueue가 하나를 공유할 수 있다.
- **ResourceFlavor**: GPU 노드처럼 컴퓨팅 자원의 종류를 노드 레이블, taint, toleration, 토폴로지 설정으로 표현한다.
- **Cohort**: ClusterQueue끼리 남는 쿼터를 빌려 쓰게 묶는다. 부모·자식 관계도 가질 수 있다.

흐름으로 보면 Job, Workload, LocalQueue, ClusterQueue 순으로 올라가고, 쿼터 문제면 ResourceFlavor나 Cohort까지 간다.

## 3. Workload 상태 조건 읽는 법

판단의 중심은 Workload의 condition이다.

| 조건 상태                             | 의미                                     |
| ------------------------------------- | ---------------------------------------- |
| `QuotaReserved=False` (`Pending`)     | 쿼터를 못 잡음, 메시지에 이유가 있음     |
| `QuotaReserved=True`, `Admitted` 아님 | 쿼터는 잡았고 admission check 대기 가능  |
| `Admitted=True`                       | admit 완료, 남은 Pending은 스케줄링 문제 |
| `Inadmissible`                        | 현재 큐 설정으로는 들어갈 수 없음        |

`Inadmissible`의 원인으로는 큐가 다루지 않는 리소스를 요청한 경우, 맞는 ResourceFlavor가 없는 경우, 큐가 멈춘 경우, admission check에 걸린 경우가 나온다.

개인적으로는 `QuotaReserved=True`인데 `Admitted`가 아닌 경우가 제일 헷갈릴 것 같았다. 쿼터는 잡혔으니 문제없어 보이지만 admission check가 아직 끝나지 않은 상태라, 쿼터만 보고 있으면 원인을 놓친다.

## 4. kubectl로 따라가는 순서

플러그인 없이도 같은 순서로 볼 수 있다. 글의 비교표에 나온 명령은 이렇다.

```bash
# 1. Workload의 조건, 메시지, 이벤트
kubectl describe workload <workload-name> -n <namespace>

# 2. Job이 쓰는 LocalQueue와 연결된 ClusterQueue
kubectl get localqueue <localqueue-name> -n <namespace> -o yaml
kubectl get clusterqueue <clusterqueue-name> -o yaml

# 3. 메시지가 flavor나 공유 쿼터를 가리키면
kubectl get resourceflavor <flavor-name> -o yaml
kubectl get cohort <cohort-name> -o yaml

# 4. admit된 뒤에도 안 뜨면 그때 Job과 Pod
kubectl describe job <job-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

글에 나온 예시가 이 순서를 잘 보여 준다. Pod 3개가 각각 CPU 1개를 요청하는 Job이라 Workload 전체 요청은 CPU 3개, 메모리 600MiB다. 그런데 ClusterQueue가 제공하는 건 CPU 2개, Pod 슬롯 2개뿐이다. 요청이 쿼터를 넘으니 Kueue가 Job을 suspend로 둔다. kube-scheduler와는 아무 관계가 없는 쿼터 문제다.

PodSet 요청과 admission 할당을 비교하는 단계도 체크리스트에 들어 있다. Workload가 무엇을 얼마나 요청했고 어느 flavor에 얼마가 배정됐는지 나란히 보면 숫자가 어디서 안 맞는지 바로 보인다.

## 5. Headlamp Kueue 플러그인으로 보면

Headlamp는 Kubernetes용 웹·데스크톱 UI다. 이번 Kueue 플러그인(0.1.0-alpha)은 Kueue `v1beta2` 리소스를 **읽기 전용**으로 보여 준다.

- Workloads: LocalQueue, 우선순위, admitted·완료 상태 목록과 상세(조건, 이벤트, PodSet, admission 할당)
- LocalQueues: 연결된 ClusterQueue, 대기·예약·admit된 개수, 관련 Workload
- ClusterQueues: flavor별 nominal 쿼터, 사용량, 빌리기·빌려주기 한도, 선점과 fair sharing 설정
- Cohorts: 부모·자식 관계, 소속 ClusterQueue, 리소스 그룹
- ResourceFlavors: ClusterQueue에서 링크로 이동

Workload, LocalQueue, ClusterQueue, ResourceFlavor, Cohort 사이를 클릭으로 오갈 수 있어서 위 kubectl 순서를 화면에서 그대로 따라가는 셈이다. 다만 생성·수정·일시정지·삭제 기능은 없고, Workload의 owner reference는 링크가 아니라 텍스트로만 나온다. 보이는 범위는 Headlamp에 로그인한 계정의 RBAC 권한에 따른다.

Kueue로 배치 작업이나 ML 학습 Job을 돌리는 팀이라면 이 정도는 정리해 둘 만하다.

- Job이 안 뜰 때 Workload 조건부터 보는 순서를 런북에 적어 두기
- 개발자에게 Workload, LocalQueue 읽기 권한이 있는지 확인하기
- ClusterQueue 쿼터와 Pod 슬롯이 실제 Job 크기와 맞는지 점검하기
- Headlamp를 이미 쓰고 있다면 플러그인으로 개발자가 직접 확인하게 하기

## 참고 자료

- [Why Is My Kubernetes Job Still Pending? Tracing Kueue Admission with Headlamp (Kubernetes Blog)](https://kubernetes.io/blog/2026/10/14/tracing-kueue-admission-with-headlamp/)
- [같은 글 원문 (Headlamp Blog)](https://headlamp.dev/blog/2026/10/12/tracing-kueue-admission-with-headlamp)
- [Kueue Troubleshooting Jobs](https://kueue.sigs.k8s.io/docs/tasks/troubleshooting/troubleshooting_jobs/)
- [Headlamp Kueue 플러그인 소스](https://github.com/headlamp-k8s/plugins/tree/main/kueue)
