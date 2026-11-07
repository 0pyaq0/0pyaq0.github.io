---
title: "Cloud Run 임시 디스크 GA: 메모리 대신 디스크로 임시 파일 다루기"
description: "Cloud Run 서비스, 잡, 워커 풀에 인스턴스 수명 동안만 유지되는 디스크 볼륨을 붙일 수 있게 됐다. 용량 한도, 수명 주기, 설정 방법을 공식 문서 기준으로 정리했다."
date: 2026-11-07T09:40:00
update: 2026-11-07T09:40:00
tags:
  - GCP
  - Serverless
---

11월 4일 Cloud Run 릴리스 노트에 **임시 디스크(ephemeral disk)가 GA가 됐다**는 항목이 올라왔다. 서비스, 잡, 워커 풀 인스턴스에 디스크 볼륨을 마운트하고, 인스턴스가 살아 있는 동안만 쓰는 기능이다. 지금까지 Cloud Run에서 큰 임시 파일을 다루려면 메모리를 넉넉하게 잡거나 Cloud Storage를 거쳐야 했다. 압축 해제, 미디어 변환, 대용량 파일 가공처럼 잠깐 쓰고 버릴 공간이 필요한 작업이라면 선택지가 하나 늘어난 셈이다.

> Cloud Run에서 임시 디스크를 쓰면 무엇이 달라지고, 어떤 제약을 먼저 알아야 하는가?

> 이 글은 Cloud Run 릴리스 노트와 서비스·잡·워커 풀별 임시 디스크 설정 문서를 읽고 정리했다. 릴리스 노트는 GA라고 했지만 일부 문서 페이지에는 아직 Preview 배너가 남아 있고 예시도 beta 명령을 쓴다. 문서가 곧 바뀔 수 있다.

## 1. 어떤 볼륨인가

문서 설명으로는 인스턴스가 시작될 때 디스크가 자동으로 프로비저닝되고, ext4로 포맷되며, 인스턴스별 키로 암호화된다. 디스크는 인스턴스 하나에 전용으로 붙고, 다른 인스턴스나 리비전과 공유되지 않는다.

**인스턴스가 종료되면 데이터는 영구 삭제된다.** 종료 원인은 리소스마다 조금씩 다르게 적혀 있다.

| 리소스  | 데이터가 사라지는 시점                              |
| ------- | --------------------------------------------------- |
| 서비스  | 인스턴스 장애, 스케일 인, 새 리비전으로 트래픽 이동 |
| 잡      | 인스턴스 장애, 태스크 완료(성공·실패 모두)          |
| 워커 풀 | 인스턴스 장애, 새 리비전으로 트래픽 이동            |

종료될 때는 모든 컨테이너에 SIGTERM을 보내고 10초 뒤 SIGKILL을 보낸다. 문서는 이 10초를 남겨야 할 결과를 영구 저장소로 마지막에 복사하는 용도로만 쓰라고 권한다.

## 2. 용량과 한도

세 문서가 같은 한도를 적고 있다.

| 항목               | 값                | 비고               |
| ------------------ | ----------------- | ------------------ |
| 볼륨 하나 크기     | `1Gi` ~ `100Gi`   |                    |
| 인스턴스당 볼륨 수 | 최대 10개         |                    |
| 인스턴스당 총량    | 기본 10GiB        | 늘리려면 쿼터 증설 |
| 리전 할당량        | 첫 배포 시 100GiB | 처음엔 0에서 시작  |

개인적으로는 마지막 줄이 가장 걸렸다. 인스턴스당 디스크 크기에 최대 인스턴스 수를 곱한 값이 리전 할당량을 넘으면 안 된다. 문서 예시대로라면 10GiB 디스크를 붙인 서비스는 인스턴스를 10개까지밖에 못 늘린다. 트래픽에 맞춰 수십 개까지 스케일 아웃하던 서비스에 무심코 큰 디스크를 붙이면 최대 인스턴스 수가 묶이는 셈이다.

실행 환경은 2세대만 지원한다. 잡과 워커 풀은 기본이 2세대고, 서비스는 `gen2`를 명시하는 예시가 나와 있다. 비용은 프로비저닝한 디스크 전체 크기와 그걸 쓰는 인스턴스의 수명에 따라 붙는다고만 적혀 있어서, 단가는 요금 페이지에서 따로 확인해야 한다.

## 3. 설정 방법

볼륨을 추가하고 컨테이너에 마운트하는 두 단계다. 잡 문서의 예시 형태는 이렇다.

```bash
gcloud run jobs update my-job \
  --add-volume=name=scratch,type=ephemeral-disk,size=20Gi \
  --add-volume-mount=volume=scratch,mount-path=/mnt/scratch
```

서비스와 워커 풀 문서의 예시는 아직 `gcloud beta run ...` 형태다. 서비스는 여기에 `--execution-environment=gen2`가 붙는다. YAML로 관리한다면 볼륨을 `emptyDir`로 정의하되 `medium: Disk`와 `sizeLimit`을 지정하는 방식이다. 마운트 경로로 `/dev`, `/proc`, `/sys`와 그 하위는 쓸 수 없다.

문서가 짚은 함정이 하나 있다. 콘솔에서 배포한 리비전이 임시 디스크를 메모리 볼륨으로 바꿔 버릴 수 있고, 그러면 메모리 부족 오류가 난다. 해결책은 `medium: Disk`를 명시한 gcloud나 YAML로 다시 배포하는 것이다. 디스크를 쓰는 서비스는 콘솔 배포를 피하고 IaC로만 관리하는 편이 안전해 보인다.

## 4. 성능과 쓰임새

Cloud Storage에서 큰 파일을 내려받아 디스크에서 가공하는 패턴이라면 Direct VPC egress를 쓰라는 안내가 있다. 트래픽을 VPC로 보내고 서브넷에 Private Google Access를 켜는 구성이다. 이 구성이 없으면 대용량 다운로드가 느리다고 적혀 있다.

잡은 라이브 마이그레이션을 지원하지 않아서 오래 도는 잡일수록 중간에 끊길 가능성을 염두에 둬야 한다.

### 점검 목록

- 메모리를 임시 파일 공간으로 쓰던 서비스를 찾아 디스크 전환을 검토한다
- 디스크 크기와 최대 인스턴스 수의 곱이 리전 할당량 안에 드는지 계산한다
- 서비스라면 2세대 실행 환경인지 확인한다
- 디스크를 쓰는 리소스는 콘솔 배포 대신 gcloud나 YAML로 배포한다
- 종료 신호 10초 안에 끝낼 수 있는 결과 저장 로직을 넣는다
- Cloud Storage 대용량 전송이 있다면 Direct VPC egress 구성을 확인한다

## 참고 자료

- [Cloud Run release notes](https://docs.cloud.google.com/run/docs/release-notes)
- [Configure ephemeral disk for services](https://docs.cloud.google.com/run/docs/configuring/services/ephemeral-disk)
- [Configure ephemeral disk for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/ephemeral-disk)
- [Configure ephemeral disk for worker pools](https://docs.cloud.google.com/run/docs/configuring/workerpools/ephemeral-disk)
