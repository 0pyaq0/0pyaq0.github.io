---
title: "Temporal Serverless Workers on Cloud Run: 워커 개수를 큐 백로그가 정한다"
description: "10월 15일 프리뷰로 나온 Temporal Serverless Workers on Cloud Run을 Google Cloud 블로그와 Temporal 문서 기준으로 정리했다. 스케일링 방식, 설정 절차, 버전 관리에서 주의할 점을 적었다."
date: 2026-10-19T09:40:00
update: 2026-10-19T09:40:00
tags:
  - GCP
  - Serverless
  - DevOps
---

Temporal 워커를 Cloud Run worker pool로 띄우면, 인스턴스 개수를 Temporal Cloud가 태스크 큐 상황을 보고 직접 조절해 준다. 일이 없으면 0대까지 내려간다. 워커 코드는 그대로 두고 오토스케일러 운영을 맡기는 셈이다. 다만 아직 프리뷰다.

> Temporal 워커를 Cloud Run에 올리면 스케일링은 누가, 무엇을 보고 하고, 운영할 때 어디서 걸리나?

> 이 글은 10월 15일 Google Cloud 블로그 공지와 Temporal의 Serverless Workers 문서를 확인해 정리했다. 프리뷰 기능이라 API와 설정은 정식 출시 전에 바뀔 수 있다.

## 1. 구성 요소

| 구성 요소                       | 하는 일                                           |
| ------------------------------- | ------------------------------------------------- |
| Cloud Run worker pool           | 공개 엔드포인트 없이 큐를 폴링하는 상시 실행 워커 |
| Worker Controller Instance(WCI) | 태스크 큐를 보고 목표 인스턴스 수를 계산          |
| Cloud Run Admin API             | WCI가 계산한 인스턴스 수를 worker pool에 반영     |
| Worker Deployment Version       | 빌드 하나와 worker pool 하나를 묶는 Temporal 단위 |

worker pool은 Cloud Run 서비스와 성격이 다르다. 인스턴스가 살아 있는 동안 CPU가 계속 할당되고, 유휴 상태처럼 보여도 Cloud Run이 줄이지 않는다. Cloud Run 문서에 따르면 worker pool 자체는 오토스케일링을 지원하지 않는다. 그래서 줄이고 늘리는 판단은 전부 Temporal 쪽 WCI가 한다. 워커가 Temporal Cloud를 폴링하는 구조라 인바운드 포트나 방화벽 규칙도 필요 없다.

## 2. 무엇을 보고 늘리고 줄이나

스케일 아웃은 두 갈래다.

- 즉시 확장: 태스크가 들어왔는데 받을 워커가 없으면(sync match 실패) 바로 인스턴스를 띄운다.
- 주기적 재계산: 태스크 도착 속도와 워커당 처리 속도를 재서 필요한 인스턴스 수를 다시 구한다. 기본 목표 사용률은 80%라 여유분을 남겨 둔다. 백로그가 쌓여 있으면 더 늘린다.

스케일 인은 보수적이다. 마지막으로 sync match가 실패한 시점부터 안정화 기간(기본 90초)을 기다리고, 줄일 때도 단계 사이에 쉰다. 개수는 사용자가 정한 최소, 최대 범위 안에서만 움직인다.

**인스턴스를 줄이는 기준은 큐 상태이지 개별 인스턴스가 하는 일이 아니다.** 그래서 Activity 실행 도중에 인스턴스가 내려갈 수 있다. 문서가 Activity Heartbeat를 권하는 것도 이 때문이다. 기본 SIGTERM 유예는 10초이고, 이를 최대 10분까지 늘리는 graceful shutdown 설정은 별도 신청이 필요한 프리뷰다.

## 3. 설정 절차

Temporal 설정 가이드 순서대로 옮겼다. 먼저 이미지를 올리고 worker pool을 0대로 만든다. pool 이름에 빌드 ID를 넣는 게 규칙이다.

```bash
gcloud run worker-pools deploy my-temporal-worker-pool-build-1 \
  --image <REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT>/<REPOSITORY>/my-temporal-worker:build-1 \
  --region <REGION> \
  --project <YOUR_GCP_PROJECT> \
  --service-account <RUNNER_SERVICE_ACCOUNT> \
  --instances 0 \
  --set-env-vars TEMPORAL_ADDRESS=<your-temporal-address>:7233,TEMPORAL_NAMESPACE=<your-namespace>,TEMPORAL_TASK_QUEUE=my-task-queue \
  --set-secrets TEMPORAL_API_KEY=<SECRET_NAME>:latest
```

다음으로 Temporal이 제공하는 Terraform 모듈로 invoker 서비스 계정을 만든다. 이 계정이 받는 기본 역할은 `roles/run.developer`이고, 직접 바꾸려면 `run.workerPools.get`과 `run.workerPools.update` 권한은 남겨야 한다. 마지막으로 Worker Deployment Version을 만들어 pool과 연결한다.

```bash
temporal worker deployment create-version \
  --namespace <YOUR_NAMESPACE> \
  --deployment-name my-app \
  --build-id build-1 \
  --gcp-cloud-run-project <YOUR_GCP_PROJECT> \
  --gcp-cloud-run-region <REGION> \
  --gcp-cloud-run-worker-pool my-temporal-worker-pool-build-1 \
  --gcp-cloud-run-service-account <INVOKER_SERVICE_ACCOUNT> \
  --gcp-cloud-run-min-instances 0 \
  --gcp-cloud-run-max-instances 30 \
  --gcp-cloud-run-initial-instances 0 \
  --gcp-cloud-run-utilization-target 0.8 \
  --gcp-cloud-run-scale-down-stabilization-duration 90s
```

그다음 `temporal worker deployment set-current-version`으로 이 버전을 현재 버전으로 지정하면 새 태스크가 이쪽으로 간다. 안정화 기간 플래그는 Temporal CLI 1.8.3 이상에서 쓸 수 있다.

## 4. 버전 관리에서 걸리는 부분

Serverless Workers는 Worker Versioning이 필수다. 빌드마다 worker pool을 따로 두고 Worker Deployment Version 하나에 연결한다. Workflow 타입별로 두 가지 동작 중 하나를 고른다.

| 동작           | 진행 중인 Workflow          | 어울리는 경우                    |
| -------------- | --------------------------- | -------------------------------- |
| `PINNED`       | 시작한 빌드에서 끝까지 실행 | 짧은 Workflow, 주문 처리         |
| `AUTO_UPGRADE` | 롤아웃 중 새 버전으로 이동  | 몇 주씩 도는 구독 결제 같은 작업 |

개인적으로 가장 조심해야 한다고 본 건 문서의 경고 하나다. 살아 있는 버전이 쓰는 pool에 새 이미지를 배포하면 새 리비전이 생기고, Cloud Run은 기본적으로 이를 모든 인스턴스에 바로 적용한다. `PINNED` Workflow도 예외 없이 non-determinism 오류를 낼 수 있다. 새 빌드는 항상 새 pool로 내야 한다. 이전 pool은 0대로 두면 비용 없이 남겨 둘 수 있다.

## 5. 도입 전에 볼 것

비용 쪽 얘기도 있다. 블로그에 따르면 worker pool은 인스턴스 과금 방식 Cloud Run 서비스보다 vCPU-시간, GB-시간 단가가 40% 가까이 낮고, 0대일 때는 컴퓨트 요금이 없다.

- 한 태스크 큐를 worker pool과 기존 상시 워커가 같이 쓰고 있지 않은지. 재계산이 전체 태스크를 세기 때문에 상시 워커가 처리 중이어도 pool이 늘어나 비용이 이중으로 든다.
- 오래 걸리는 Activity에 Heartbeat를 넣었는지
- 배포 파이프라인이 빌드마다 새 pool과 새 버전을 만들게 되어 있는지
- 최소 인스턴스 0의 콜드 스타트를 감당할 수 있는지

## 참고 자료

- [Temporal Serverless Workers on Cloud Run: Scale workers ahead of demand (Google Cloud Blog)](https://cloud.google.com/blog/products/serverless/temporal-serverless-workers-on-cloud-run-worker-pools)
- [Serverless Workers on GCP Cloud Run (Temporal Docs)](https://docs.temporal.io/serverless-workers/cloud-run)
- [Cloud Run Serverless Worker 설정 가이드 (Temporal Docs)](https://docs.temporal.io/production-deployment/worker-deployments/serverless-workers/cloud-run)
- [Deploy worker pools (Cloud Run Docs)](https://docs.cloud.google.com/run/docs/deploy-worker-pools)
