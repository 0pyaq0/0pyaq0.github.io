---
title: "PostgreSQL·Oracle 11월 보안 패치: 일반 로그인 계정이 DB 서버 코드 실행까지 간다"
description: "보안 연구자가 PostgreSQL과 Oracle Database에서 낮은 권한 계정으로 서버 OS 코드 실행까지 가는 공격을 시연했다. 공식 보안 페이지와 Oracle 11월 CSPU를 기준으로 영향 버전, 수정 버전, 패치 전에 줄일 수 있는 권한을 정리했다."
date: 2026-11-27T09:40:00
update: 2026-11-27T09:40:00
tags:
  - PostgreSQL
  - Security
  - Database
---

11월 19일 The Hacker News에 depthfirst의 Zheng Yu가 PostgreSQL, MySQL, Oracle Database를 대상으로 원격 코드 실행 공격을 시연했다는 기사가 올라왔다. 공통점은 슈퍼유저가 아니어도 된다는 점이다. PostgreSQL은 객체를 만들 수 있는 일반 로그인 계정이면 DB 서버를 돌리는 OS 사용자 권한으로 코드를 실행한다. Oracle은 `CREATE SESSION` 권한만 있으면 되는 CVSS 9.9 취약점이 들어 있다. 패치는 이미 나와 있다. PostgreSQL은 11월 12일, Oracle은 11월 17일이다. "앱 계정은 권한이 적으니 괜찮다"며 미뤄 둔 곳이라면 다시 볼 일이다.

> 낮은 권한 DB 계정만으로 서버가 넘어간다면, 패치 범위와 패치 전까지의 조치를 어디까지 잡아야 할까?

> 이 글은 PostgreSQL 보안 페이지의 CVE-2026-6460, CVE-2026-116331 항목과 Oracle Critical Security Patch Update Advisory(2026년 11월)를 읽고 정리했다. 기사에 나온 MySQL, ClickHouse, ORDS 관련 내용은 공식 문서로 확인하지 못해 따로 표시했다. 기사도 전체 공격 체인은 독립적으로 재현되지 않았다고 적고 있다.

## 1. PostgreSQL: 객체 생성자가 OS 권한으로 코드 실행

11월 정기 릴리스의 CVE 52건 중 이번 시연과 맞닿은 건 타입 혼동(type confusion) 계열이다.

| CVE             | 경로                                             | CVSS |
| --------------- | ------------------------------------------------ | ---- |
| CVE-2026-116331 | 사용자 정의 집계의 `SORTOP` 옵션, min/max 최적화 | 8.8  |
| CVE-2026-6460   | `ALTER ... SET DATA TYPE` 등 DDL                 | 8.8  |

두 항목 모두 설명이 "object creator"가 데이터베이스를 실행하는 OS 사용자 권한으로 임의 코드를 실행한다는 식이다. 벡터는 `AV:N/AC:L/PR:L/UI:N`이다. 네트워크로, 낮은 권한 계정으로, 상호작용 없이 된다는 뜻이다. CVE-2026-6460은 다른 DDL 경로도 있다고 적혀 있다.

영향 버전과 수정 버전은 두 건이 같다.

| 브랜치 | 수정 버전 |
| ------ | --------- |
| 18     | `18.7`    |
| 17     | `17.12`   |
| 16     | `16.16`   |
| 15     | `15.20`   |
| 14     | `14.25`   |

공식 페이지에 우회 방법은 없다. 업그레이드가 유일한 해법이다. 18.7 이후 후속 작업은 지난 글에서 정리했다.

## 2. Oracle Database: CREATE SESSION만으로 9.9

Oracle은 11월 17일 CSPU(Critical Security Patch Update)를 냈다. 전체 655건이고, Oracle Database Server 항목은 7건이다. 기사가 지목한 CVE-2026-114819는 Oracle 문서 크레딧에도 "Zheng Yu of depthfirst"로 올라 있다.

| CVE             | 구성 요소      | 필요 권한      | CVSS |
| --------------- | -------------- | -------------- | ---- |
| CVE-2026-114819 | Oracle Text    | Create Session | 9.9  |
| CVE-2026-114848 | Oracle Text    | Create Session | 9.9  |
| CVE-2026-114822 | RDBMS          | Create Session | 9.9  |
| CVE-2026-72897  | RDBMS(OpenSSL) | 없음           | 7.5  |

9.9짜리 세 건은 인증 없이 원격으로는 안 되지만, 접속만 가능한 계정이면 된다. 영향 버전은 대략 19.3~19.33, 21.3~21.24, 23.4.0~23.26.4 사이이고 CVE마다 끝 번호가 조금씩 다르다. 인증 없이 원격으로 가능한 건 OpenSSL(7.5), Python(7.4), Apache HttpClient(4.3) 서드파티 구성 요소 세 건이다.

기사에 따르면 Oracle 쪽 공격은 계정 없이 시작한다. 외부에 노출된 ORDS(Oracle REST Data Services) GraphQL 엔드포인트의 결함과 Oracle Text 버그를 엮는 방식이다. 기사가 적은 ORDS CVE 번호는 11월 CSPU의 ORDS 표에서는 찾지 못했다. 다만 11월 CSPU에도 ORDS 패치가 8건 있고 그중 5건이 인증 없이 원격으로 가능하다고 되어 있다. 영향 버전은 24.2.0~26.3.0이다. 개인적으로는 이 부분이 더 걸렸다. DB를 직접 열어 두지 않았어도 ORDS를 열어 뒀다면 앞문이 따로 있었던 셈이다.

## 3. 기사에만 있는 것

공식 문서로 확인하지 못한 항목이다.

- MySQL: 임시 테이블을 만들 수 있는 계정으로 공격, 26.7.0~26.7.1 대상, 10월 20일 수정.
- ClickHouse: CVE 없음, 9월에 수정, 26.9 이상과 일부 백포트 버전에 반영.
- 공개 PoC 여부와 실제 공격 관측 여부.

## 4. 패치 전까지 줄일 수 있는 것

공식 우회책은 없으니 아래는 권한을 줄여 공격면을 좁히는 수준이다. 패치를 대신하지 않는다.

### PostgreSQL

공격 전제가 "객체를 만들 수 있는 계정"이다. 기사는 기본으로 주어지는 `TEMPORARY` 권한만으로도 된다고 설명한다. 앱 계정에 꼭 필요한 권한인지부터 본다.

```sql
-- 버전 확인
SELECT version();

-- 데이터베이스별 권한(ACL) 확인, PUBLIC에 T(TEMPORARY)가 있는지 본다
SELECT datname, datacl FROM pg_database;

-- 임시 테이블이 필요 없는 DB라면 PUBLIC의 TEMPORARY 회수
REVOKE TEMPORARY ON DATABASE appdb FROM PUBLIC;

-- public 스키마의 CREATE 회수(15 이상은 기본값)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

`TEMPORARY`를 회수하면 임시 테이블을 쓰는 쿼리나 마이그레이션 도구가 깨질 수 있다.

### Oracle

Oracle Text 설치 여부부터 본다.

```sql
SELECT comp_id, comp_name, version, status
FROM dba_registry
WHERE comp_id = 'CONTEXT';
```

ORDS를 쓴다면 외부 노출 범위와 버전도 확인한다.

### 점검 목록

- [ ] PostgreSQL을 `18.7`, `17.12`, `16.16`, `15.20`, `14.25` 이상으로 올렸는가
- [ ] 앱 계정에 `TEMPORARY`, `CREATE`가 정말 필요한가
- [ ] Oracle Database에 11월 CSPU를 적용했는가
- [ ] Oracle Text를 쓰지 않는데 설치되어 있지는 않은가
- [ ] ORDS가 인터넷에 노출되어 있다면 버전이 26.3.0보다 높은가
- [ ] 다음 Oracle 일정(12월 15일 CSPU, 2027년 1월 19일 CPU)을 캘린더에 넣었는가

## 참고 자료

- [PostgreSQL: CVE-2026-6460](https://www.postgresql.org/support/security/CVE-2026-6460/)
- [PostgreSQL: CVE-2026-116331](https://www.postgresql.org/support/security/CVE-2026-116331/)
- [Oracle Critical Security Patch Update Advisory - November 2026](https://www.oracle.com/security-alerts/cspunov2026.html)
- [The Hacker News: Researcher Demonstrates Database RCE Exploits](https://thehackernews.com/2026/11/researcher-demonstrates-database-rce.html)
