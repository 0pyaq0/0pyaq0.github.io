---
title: "EC2 Auto Scaling Launch Before Terminate 계정 설정: 교체 중 용량이 줄지 않는 대신 생기는 일"
description: "10월 26일 EC2 Auto Scaling에 계정 단위 launchBeforeTerminate 설정이 생겼다. 적용 범위, 기존 그룹 설정과의 우선순위, Capacity Reservation과 겹칠 때의 함정을 공식 문서 기준으로 정리했다."
date: 2026-10-27T09:40:00
update: 2026-10-27T09:40:00
tags:
  - AWS
  - DevOps
---

EC2 Auto Scaling에서 인스턴스를 교체할 때 "새 인스턴스를 먼저 띄우고, 헬스 체크를 통과하면 옛 인스턴스를 내리는" 동작을 이제 계정 단위 기본값으로 켤 수 있다. 10월 26일 추가된 `launchBeforeTerminate` 계정 설정이다. 지금까지는 그룹마다 instance maintenance policy를 걸거나 instance refresh를 돌릴 때마다 healthy percentage를 지정해야 했다. 설정 하나로 그룹 수십 개의 교체 동작이 바뀌는 셈이라 편하지만, 교체 순간마다 인스턴스가 하나 더 뜨기 때문에 용량 확보와 Capacity Reservation 쪽에서 예상 못 한 일이 생길 수 있다.

> 계정 설정을 켜면 어떤 그룹에 어떤 값이 적용되고, 무엇을 미리 확인해야 하나?

> 이 글은 AWS What's New 공지와 EC2 Auto Scaling 사용 설명서의 계정 설정, launch before terminate 페이지를 확인해 정리했다.

## 1. 무엇이 바뀌었나

새로 생긴 건 계정 설정 API 두 개다. `PutAccountSetting`, `DescribeAccountSettings`이고, 지금 있는 설정은 `launchBeforeTerminate` 하나다. 값은 `enabled` 또는 `disabled`. 모든 리전에서 추가 비용 없이 쓸 수 있다.

```bash
aws autoscaling put-account-setting \
  --name launchBeforeTerminate \
  --value enabled

aws autoscaling describe-account-settings \
  --name launchBeforeTerminate
```

**설정은 계정 전체가 아니라 리전 하나에만 적용된다.** 여러 리전을 쓰면 리전마다 켜야 한다. 공지만 읽으면 계정 전체에 걸리는 것처럼 보여서 놓치기 쉽다.

적용되는 교체 이벤트는 instance refresh, 헬스 체크 실패에 따른 교체, 최대 인스턴스 수명(maximum instance lifetime) 교체, 가용 영역 재조정이다.

## 2. 어떤 그룹에 어떤 값이 걸리나

계정 설정을 켜면 최소 healthy percentage `100`, 최대 healthy percentage `110`이 기본값이 된다. 교체 중에도 원하는 용량 아래로 내려가지 않고, 잠깐 10%까지 넘칠 수 있다는 뜻이다. 다만 모든 그룹에 무조건 걸리지는 않는다.

| 상황                                       | 적용되는 값                    |
| ------------------------------------------ | ------------------------------ |
| instance refresh에 healthy percentage 지정 | refresh에 지정한 값            |
| 그룹에 instance maintenance policy 있음    | 그룹 정책 값                   |
| 둘 다 없음                                 | 계정 설정 기본값 `100` / `110` |

이미 그룹 정책을 세심하게 잡아 둔 팀이라면 그 그룹은 영향이 없다. 반대로 정책 없이 기본 동작에 기대던 그룹들이 한꺼번에 바뀐다. 개인적으로는 이 "조용히 바뀌는 그룹" 목록을 먼저 뽑아 보는 게 가장 쓸모 있어 보였다.

## 3. 인스턴스가 하나 더 뜬다는 것

문서가 짚는 고려 사항은 두 가지다. 교체마다 인스턴스 하나가 잠깐 더 돌고, 그만큼 잠깐 더 과금된다.

교체용 인스턴스를 못 띄우면 어떻게 되나. Auto Scaling은 원래 인스턴스를 그대로 두고 재시도한다. 용량이 줄지는 않지만, 교체가 계속 미뤄질 수 있다. 문서가 드는 원인은 그룹의 인스턴스 타입과 가용 영역에 On-Demand 용량이 부족하거나 Capacity Reservation이 꽉 찬 경우다. 대책으로는 원하는 용량보다 여유 있게 예약하기, On-Demand로도 띄울 수 있게 두기, 인스턴스 타입과 가용 영역 선택지 늘리기를 제시한다.

## 4. Capacity Reservation과 겹칠 때

문서에서 가장 꼼꼼히 읽어야 할 부분이 여기다. 예약을 어떻게 참조하느냐에 따라 교체 후 결과가 달라진다.

| 예약 참조 방식                      | 교체 후 결과                                         |
| ----------------------------------- | ---------------------------------------------------- |
| open 예약 또는 리소스 그룹으로 참조 | 비워진 예약 슬롯이 On-Demand 인스턴스를 다시 흡수    |
| 예약 ID로 직접 지정(targeted)       | 인스턴스 하나가 On-Demand로 남고 예약 슬롯 하나는 빔 |
| 그룹 크기보다 예약이 큼(예: 11/10)  | 교체 인스턴스가 빈 예약 슬롯으로 바로 뜸             |

두 번째 경우가 함정이다. 예약 ID로 직접 지정한 그룹은 교체가 한 번 일어날 때마다 예약은 놀고 On-Demand 요금이 나가는 인스턴스가 생길 수 있다. 문서는 예약 커버리지를 유지하려면 `CapacityReservationResourceGroupArns`로 리소스 그룹을 통해 참조하거나 open 예약을 쓰라고 권한다.

## 5. 켜기 전에 볼 것

- 쓰는 리전마다 따로 켜야 한다는 점
- instance maintenance policy가 없는 그룹 목록. 이 그룹들의 교체 동작이 바뀐다.
- 교체 중 인스턴스가 10% 늘어나도 서비스 쿼터와 서브넷 IP가 버티는지
- 예약 ID로 Capacity Reservation을 직접 참조하는 그룹이 있는지
- 인스턴스 타입이나 가용 영역이 하나뿐이라 교체용 용량을 못 구할 위험이 있는 그룹은 없는지
- 교체가 미뤄질 때 이를 알아챌 모니터링이 있는지

## 참고 자료

- [AWS EC2 Auto Scaling now supports Launch Before Terminate at account-level (AWS What's New)](https://aws.amazon.com/about-aws/whats-new/2026/10/ec2-auto-scaling-launch-before-terminate/)
- [Launch replacement instances before terminating old ones (EC2 Auto Scaling 사용 설명서)](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-launch-before-terminate-account-setting.html)
- [Amazon EC2 Auto Scaling account settings (EC2 Auto Scaling 사용 설명서)](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-account-settings.html)
- [Manage account settings (EC2 Auto Scaling 사용 설명서)](https://docs.aws.amazon.com/autoscaling/ec2/userguide/account-settings-manage.html)
