---
title: "PostgreSQL 19 출시: 업그레이드 전에 걸리는 호환성 변경부터 본다"
description: "11월 19일 PostgreSQL 19가 나왔다. REPACK과 pg_plan_advice 같은 새 기능보다 먼저, pg_upgrade를 막거나 동작을 바꾸는 마이그레이션 항목을 공식 발표문과 릴리스 노트 기준으로 정리했다."
date: 2026-11-23T09:40:00
update: 2026-11-23T09:40:00
tags:
  - PostgreSQL
  - Database
---

PostgreSQL 19가 11월 19일 정식으로 나왔다. 발표문 앞쪽은 `REPACK (CONCURRENTLY)`, 실행 계획에 힌트를 거는 `pg_plan_advice`, 병렬 autovacuum 같은 기능이 채운다. 그런데 운영 중인 DB를 올리는 입장에서 먼저 읽어야 할 곳은 릴리스 노트의 "Migration to Version 19" 절이다. JIT가 기본으로 꺼지고, `max_locks_per_transaction` 기본값이 두 배가 되고, 특정 인덱스가 있으면 pg_upgrade가 아예 진행을 거부한다.

> 18에서 19로 올릴 때 무엇이 업그레이드를 막고, 무엇이 조용히 동작을 바꿀까?

> 이 글은 PostgreSQL 19 발표문과 릴리스 노트의 마이그레이션 절을 읽고 정리했다. 릴리스 노트 뒷부분(빌드 환경 변경 등)은 끝까지 확인하지 못해 다루지 않는다.

## 1. pg_upgrade가 거부하는 클러스터

메이저 업그레이드 방식은 그대로다. pg_dumpall로 덤프·복원하거나, pg_upgrade를 쓰거나, 논리 복제로 옮긴다. 이번 버전에서는 pg_upgrade가 사전 검사에서 멈추는 조건이 두 가지 생겼다.

| 조건                                | 이유                                                                      | 대응                                  |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| btree_gist의 `inet`/`cidr` 인덱스   | 기본 opclass가 GiST로 바뀜, 기존 인덱스가 반환해야 할 행을 빠뜨릴 수 있음 | 업그레이드 전에 인덱스 제거 후 재생성 |
| DB, 롤, 테이블스페이스 이름에 CR/LF | 이름에 줄바꿈 문자 금지                                                   | 이름 변경                             |

btree_gist로 IP 컬럼에 인덱스나 exclusion constraint를 걸어 둔 곳이라면 아래 쿼리로 미리 찾아 둔다.

```sql
SELECT n.nspname, c.relname AS index_name, opc.opcname
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_opclass opc ON opc.oid = ANY (i.indclass::oid[])
WHERE opc.opcname IN ('gist_inet_ops', 'gist_cidr_ops');
```

## 2. 기본값이 바뀌는 설정

에러는 안 나지만 성능이나 용량 계산이 달라지는 항목이다.

| 설정                        | 18     | 19                                                  |
| --------------------------- | ------ | --------------------------------------------------- |
| `jit`                       | 켜짐   | 꺼짐                                                |
| `max_locks_per_transaction` | `64`   | `128`                                               |
| TOAST 압축(LZ4 빌드)        | `pglz` | `lz4`                                               |
| `io_workers`                | 사용   | 제거, `io_min_workers`/`io_max_workers` 등으로 대체 |

`max_locks_per_transaction`은 숫자만 보면 늘었으니 그냥 두면 될 것 같지만, 릴리스 노트는 **같은 용량을 원하면 기존 설정값을 두 배로 올려야 한다**고 적고 있다. 값을 직접 지정해 둔 클러스터라면 의미가 달라진 셈이다.

JIT는 분석성 쿼리에서 효과를 보던 곳이라면 업그레이드 후 실행 시간이 바뀔 수 있다. 필요하면 `jit = on`으로 되돌리면 된다.

## 3. 쿼리 결과나 동작이 바뀌는 부분

### standard_conforming_strings 고정

`standard_conforming_strings`가 항상 `on`으로 고정되고 `escape_string_warning`은 사라졌다. 릴리스 노트에 따르면 19 이전 pg_dump로 `standard_conforming_strings = off` 상태에서 만든 덤프는 19에 제대로 들어가지 않는다.

### 작은 동작 변경들

- 행이 없을 때 `json_array()`가 `NULL` 대신 빈 JSON 배열을 돌려준다.
- `COPY FROM ... WHERE`에서 시스템 컬럼을 쓸 수 없다.
- postgres_fdw가 `READ ONLY`, `DEFERRABLE`을 원격 세션에도 넘긴다. 읽기 전용 트랜잭션에서 원격 행을 수정하던 코드는 이제 실패한다.
- 비용 기반 지연을 켠 상태에서 병렬 VACUUM이 느려질 수 있다. 리더와 워커가 지연 한도를 나눠 쓰기 때문이다.

`json_array()` 변경은 애플리케이션에서 `NULL` 체크로 분기하던 코드를 조용히 바꾼다. 개인적으로는 이런 게 에러보다 찾기 어렵다.

## 4. 인증과 모니터링

RADIUS 인증이 제거됐다. md5 비밀번호 인증은 18에서 deprecated였고, 19부터는 인증에 성공해도 경고를 띄운다. `md5_password_warnings`로 끌 수는 있지만 발표문은 향후 제거를 예고하고 있으니 SCRAM으로 옮길 시점이다.

모니터링 쿼리도 확인할 게 있다.

- `pg_stat_subscription_stats.sync_error_count`가 `sync_table_error_count`로 이름이 바뀌었다.
- 대기 이벤트 `BUFFERPIN`은 `BUFFER`로, `BufferPin`은 `BufferCleanup`으로 바뀌고 `BufferContent`는 세 개로 쪼개졌다.

## 5. 업그레이드 후 할 일

전문 검색과 pg_trgm이 문자 분류에 DB의 로케일 프로바이더를 쓰도록 바뀌었다. 릴리스 노트는 pg_upgrade 후 관련 인덱스를 다시 만들고 저장된 `tsvector`를 다시 계산하라고 권한다. fuzzystrmatch도 비ASCII 입력 처리가 바뀌어 해당 함수를 쓰는 인덱스는 재생성 대상이다. `MULE_INTERNAL` 인코딩은 제거돼서 이 인코딩을 쓰는 DB는 다른 인코딩으로 덤프·복원해야 한다.

### 점검 목록

- [ ] btree_gist `inet`/`cidr` 인덱스를 찾아 정리했는가
- [ ] `max_locks_per_transaction`을 직접 지정했다면 값을 두 배로 조정했는가
- [ ] JIT 기본값 변경 후 분석 쿼리 실행 시간을 비교했는가
- [ ] `json_array()` 결과를 `NULL`로 판단하는 코드가 있는가
- [ ] md5 인증 계정과 RADIUS 설정이 남아 있는가
- [ ] 모니터링 쿼리의 컬럼명과 대기 이벤트 이름을 바꿨는가
- [ ] 업그레이드 후 FTS, pg_trgm 인덱스를 재생성했는가

## 참고 자료

- [PostgreSQL 19 Released!](https://www.postgresql.org/about/news/postgresql-19-released-3449/)
- [PostgreSQL 19 Release Notes](https://www.postgresql.org/docs/19/release-19.html)
