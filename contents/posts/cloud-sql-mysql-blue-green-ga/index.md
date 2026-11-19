---
title: "Cloud SQL for MySQL 블루-그린 배포 GA: 업그레이드를 별도 인스턴스에서 미리 돌려 본다"
description: "Cloud SQL for MySQL의 블루-그린 배포가 11월 17일 GA가 됐다. 그린 인스턴스가 만들어지는 방식, 전환 중 다운타임, 지원하지 않는 구성, gcloud 명령을 공식 문서 기준으로 정리했다."
date: 2026-11-19T09:40:00
update: 2026-11-19T09:40:00
tags:
  - GCP
  - Database
---

MySQL 메이저 버전 업그레이드는 그 자리에서 올리면 되돌리기 어렵고, 복제본으로 옮기면 전환 절차를 직접 챙겨야 한다. Cloud SQL for MySQL의 블루-그린 배포는 이 과정을 서비스 기능으로 묶었다. 10월 8일 프리뷰로 나왔고, 11월 17일 릴리스 노트에서 GA로 올라갔다. 같은 날 나온 Cloud SDK 594.0.0에서도 `gcloud sql blue-green-deployments` 명령이 GA 트랙으로 옮겨졌다.

> 운영 중인 MySQL 인스턴스를 업그레이드할 때 블루-그린 배포를 쓰려면 무엇을 먼저 확인해야 할까?

> 이 글은 Cloud SQL 릴리스 노트, Cloud SDK 릴리스 노트, 블루-그린 배포 개요와 생성, 전환, 삭제 문서를 읽고 정리했다. 문서 페이지 일부에는 아직 Preview 표시가 남아 있어서, 릴리스 노트와 문서가 다른 부분은 따로 적었다.

## 1. 어떻게 동작하나

Cloud SQL은 현재 운영 환경(블루)을 그대로 비춘 별도 스테이징 환경(그린)을 만들고, 블루에서 그린으로 논리 복제를 계속 이어 간다. 그린에서 새 버전이나 바뀐 설정을 검증한 뒤 전환하면, Cloud SQL이 두 인스턴스의 연결 엔드포인트를 서로 바꾼다. 전환 문서에는 애플리케이션 설정이나 연결 문자열을 바꿀 필요가 없다고 적혀 있다.

전환이 끝나면 그린이 운영용 읽기 쓰기 인스턴스가 되고, 기존 블루는 독립된 읽기 쓰기 인스턴스로 남는다.

쓰임새는 두 가지다.

- 메이저 버전 업그레이드: MySQL 8.0에서 8.4로만 지원한다. 8.0.18은 제외된다.
- 버전은 그대로 두고 머신 타입이나 데이터베이스 플래그 같은 설정만 바꿔서 미리 검증하는 용도

대상 버전은 배포를 만든 뒤에는 바꿀 수 없다.

## 2. 전환 중 다운타임

전환 문서에 적힌 다운타임은 에디션에 따라 다르다.

| 에디션          | 전환 다운타임(문서 기준)                           |
| --------------- | -------------------------------------------------- |
| Enterprise Plus | 보통 1초 미만                                      |
| Enterprise      | 보통 60초 미만, 워크로드와 복제 지연에 따라 달라짐 |

Enterprise 에디션이라면 복제 지연이 전환 시간에 그대로 들어간다는 뜻이다. 전환 직전에 그린의 복제 지연을 확인하는 편이 안전하다.

한 가지 오해하기 쉬운 점이 있다. 그린 인스턴스는 블루에 장애가 났을 때 장애 조치 대상으로 쓸 수 없다. 고가용성 구성을 대신하지 않는다.

## 3. 쓸 수 있는 인스턴스 조건

생성 문서에 적힌 조건과 제외 대상을 표로 모았다.

| 구분               | 내용                                                                |
| ------------------ | ------------------------------------------------------------------- |
| 엔진               | Cloud SQL for MySQL만 지원. PostgreSQL과 SQL Server는 미지원        |
| 버전               | MySQL 5.7, 8.0, 8.4 (8.0.18 제외)                                   |
| 에디션             | Enterprise, Enterprise Plus                                         |
| 블루 인스턴스 상태 | RUNNING, 최신 유지보수 버전, 바이너리 로그와 자동 백업 활성화       |
| 네트워크           | 새 네트워크 아키텍처 필요, 이전 아키텍처는 미지원                   |
| 지원하지 않는 구성 | 읽기 복제본, Private Service Connect 아웃바운드 연결, IAM 그룹 인증 |

가장 걸리기 쉬운 항목은 읽기 복제본이다. 읽기 트래픽을 복제본으로 나눠 둔 인스턴스라면 지금은 이 기능을 그대로 쓸 수 없다.

## 4. gcloud로 진행하기

같은 버전으로 설정만 바꿔 볼 때는 원본 인스턴스와 리전만 지정한다.

```bash
gcloud sql blue-green-deployments create my-bg \
  --source-instance=prod-mysql \
  --region=asia-northeast3 \
  --async
```

8.4로 올리는 경우에는 대상 버전을 붙인다.

```bash
gcloud sql blue-green-deployments create my-bg \
  --source-instance=prod-mysql \
  --target-database-version=MYSQL_8_4 \
  --region=asia-northeast3 \
  --async
```

그린에서 검증을 마치면 전환한다. 전환 문서 예시는 아직 `beta` 트랙으로 되어 있다.

```bash
gcloud beta sql blue-green-deployments switchover my-bg \
  --region=asia-northeast3 \
  --async

gcloud sql operations wait OPERATION_ID
```

SDK 594.0.0에서 명령 그룹이 GA로 올라갔으니 `beta` 없이도 동작할 가능성이 높지만, 문서가 갱신되기 전이라 직접 확인하지는 못했다.

## 5. 되돌리기와 비용

전환 전이라면 배포를 삭제하는 것으로 끝난다. 삭제 문서에는 블루 운영 인스턴스는 계속 실행되며 영향을 받지 않는다고 적혀 있다.

전환 후에는 문서에 정리된 롤백 절차가 없다. 이전 블루를 남겨 두려면 `--delete-old-source` 없이 배포를 삭제하고, 정리까지 하려면 이 플래그를 붙인다.

```bash
# 이전 블루 인스턴스를 남긴다
gcloud sql blue-green-deployments delete my-bg --region=asia-northeast3

# 이전 블루 인스턴스까지 지운다
gcloud sql blue-green-deployments delete my-bg --region=asia-northeast3 --delete-old-source
```

비용은 두 인스턴스가 함께 있는 동안 둘 다 청구된다. 전환 후 검증이 끝나면 이전 인스턴스를 언제 지울지 미리 정해 두는 편이 낫다.

### 점검 목록

- [ ] 대상 인스턴스가 MySQL 5.7, 8.0, 8.4이고 8.0.18이 아닌가
- [ ] 읽기 복제본, PSC 아웃바운드 연결, IAM 그룹 인증을 쓰지 않는가
- [ ] 바이너리 로그와 자동 백업이 켜져 있고 최신 유지보수 버전인가
- [ ] Enterprise 에디션이라면 전환 시점의 복제 지연과 재시도 동작을 확인했는가
- [ ] 전환 후 이전 블루 인스턴스를 지울 시점을 정했는가

## 참고 자료

- [Cloud SQL release notes](https://docs.cloud.google.com/sql/docs/release-notes)
- [Google Cloud SDK release notes](https://docs.cloud.google.com/sdk/docs/release-notes)
- [About blue-green deployments](https://docs.cloud.google.com/sql/docs/mysql/about-blue-green-deployments)
- [Create a blue-green deployment](https://docs.cloud.google.com/sql/docs/mysql/create-blue-green-deployment)
- [Switch over a blue-green deployment](https://docs.cloud.google.com/sql/docs/mysql/switchover-blue-green-deployment)
- [Delete a blue-green deployment](https://docs.cloud.google.com/sql/docs/mysql/delete-blue-green-deployment)
