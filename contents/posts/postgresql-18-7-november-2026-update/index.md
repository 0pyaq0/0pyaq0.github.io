---
title: "PostgreSQL 18.7 외 마이너 릴리스: 바이너리만 바꾸고 끝내면 안 되는 이유"
description: "PostgreSQL이 CVE 52건과 버그 140여 건을 고친 마이너 릴리스를 내면서 14를 지원 종료했다. 이번에는 업데이트 뒤 REINDEX와 새 전체 백업 같은 후속 작업이 붙어 있어서, 공식 공지 기준으로 순서를 정리했다."
date: 2026-11-13T09:40:00
update: 2026-11-13T09:40:00
tags:
  - PostgreSQL
  - Database
  - Security
---

11월 12일 PostgreSQL이 18.7, 17.12, 16.16, 15.20, 14.25를 내놨다. 보안 취약점 52건과 버그 140여 건을 고친 릴리스다. 그리고 14.25가 PostgreSQL 14의 마지막 릴리스다. 보통 마이너 업데이트는 서버를 멈추고 바이너리만 바꾸면 끝나는데, 이번에는 인덱스 손상 버그가 여럿 고쳐졌고 증분 백업도 믿지 말라는 안내가 붙었다. 패키지 업데이트만 하고 넘어가면 이미 깨진 인덱스와 백업은 그대로 남는다.

> 바이너리를 올린 뒤 무엇을 더 해야 하고, 14는 어떻게 해야 할까?

> 이 글은 PostgreSQL 공식 릴리스 공지와 18.7 릴리스 노트를 확인해 정리했다. 개별 CVE의 영향 버전은 각 CVE 페이지를 따로 봐야 한다.

## 1. 이번 릴리스의 범위

| 항목         | 내용                                       |
| ------------ | ------------------------------------------ |
| 릴리스 날짜  | 2026-11-12                                 |
| 대상 버전    | `18.7`, `17.12`, `16.16`, `15.20`, `14.25` |
| 수정 규모    | 보안 취약점 52건, 버그 140여 건            |
| 함께 나온 것 | PostgreSQL 19 RC 2                         |

CVE 52건 중 CVSS 8.8짜리가 절반을 넘는다. 공지 목록을 보니 타입 혼동(type confusion)과 use-after-free가 대부분이었다. plperl 관련이 여러 건이고, `pg_dump`, `pg_restore`, `reindexdb`, `vacuumdb` 같은 클라이언트 도구 쪽 SQL 인젝션과 코드 실행도 있다. RLS 우회도 몇 건 보인다. `DROP OWNED`가 남의 테이블에 걸린 restrictive 정책을 지우는 `CVE-2026-116311`, `INSERT ... ON CONFLICT`가 RLS 정책을 무시하고 행을 읽는 `CVE-2026-120154`가 그렇다.

여러 팀이 한 클러스터를 나눠 쓰거나 RLS로 테넌트를 나누는 구조라면 더 미룰 이유가 없다.

## 2. 바이너리 교체 자체는 평소와 같다

공지 표현 그대로 마이너 릴리스는 누적(cumulative)이라 dump/restore나 `pg_upgrade`가 필요 없다. 서버를 멈추고 바이너리를 바꾼 뒤 다시 띄우면 된다. 18.7 릴리스 노트도 18.X를 쓰고 있다면 dump/restore는 필요 없다고 적었다. 다만 18.6보다 이전 버전에서 올라온다면 18.6 릴리스 노트의 후속 작업도 같이 봐야 한다.

## 3. 업데이트 뒤에 할 일

**이번 릴리스에서 가장 손이 가는 부분이 여기다.** 18.7 릴리스 노트는 인덱스 손상으로 이어질 수 있는 버그가 여럿 발견됐다며, 변경 목록에서 `REINDEX`가 언급된 항목을 보고 해당 인덱스를 다시 만들라고 안내한다.

### 인덱스 다시 만들기

공지에 나온 대상은 이렇다.

| 대상                        | 증상                        | 조치                         |
| --------------------------- | --------------------------- | ---------------------------- |
| GIN 인덱스                  | 손상 가능                   | 의심되면 `REINDEX INDEX`     |
| `gist_trgm_ops` GiST 인덱스 | 검색에서 행 누락            | `REINDEX`                    |
| TOAST 테이블                | `missing chunk number` 오류 | `REINDEX TABLE`              |
| 길이 없는 `bpchar` B-tree   | 손상 가능                   | `REINDEX` (`char(n)`은 무관) |

pg_trgm으로 `LIKE '%검색어%'`를 가속하는 경우가 흔하니 `gist_trgm_ops`는 한 번 찾아보는 게 좋다.

```sql
-- gist_trgm_ops를 쓰는 인덱스 찾기
SELECT indexrelid::regclass AS index_name
FROM pg_index i
JOIN pg_opclass o ON o.oid = ANY (i.indclass)
WHERE o.opcname = 'gist_trgm_ops';

-- 운영 중이라면 잠금이 덜한 방식으로
REINDEX INDEX CONCURRENTLY your_index_name;
```

### 증분 백업은 새로 시작

PostgreSQL 17부터 들어온 증분 백업을 쓰고 있다면 영향이 크다. 릴리스 노트는 기존 증분 백업 파일을 신뢰하지 말라고 적었다. 업데이트 뒤 새 전체 백업을 받고, 이후 증분 백업은 그걸 기준으로 쌓아야 한다.

### 파티션 테이블의 NOT NULL NO INHERIT

파티션 테이블에 `NOT NULL NO INHERIT` 제약을 만드는 것이 이제 모든 경우에 막혔다. 이미 만들어진 것은 아래 쿼리로 찾는다.

```sql
SELECT conrelid::regclass, conname
FROM pg_constraint
WHERE contype = 'n' AND connoinherit
  AND conrelid IN (SELECT oid FROM pg_class WHERE relkind = 'p');
```

필요 없는 제약이면 `ALTER TABLE ... DROP CONSTRAINT`로 지우고, 필요한 제약이면 `ALTER TABLE ... ALTER CONSTRAINT ... INHERIT`로 고친다. 파티션 중 해당 컬럼에 NULL이 있으면 후자는 실패한다.

## 4. PostgreSQL 14는 여기서 끝난다

공지는 이번이 PostgreSQL 14의 마지막 릴리스이고, 이제 보안·버그 수정을 더 받지 못한다고 못 박았다.

메이저 업그레이드는 `pg_upgrade`나 `pg_dump`/`pg_restore`로 한다. 이참에 바로 다음 메이저까지 보고 있다면 일정이 하나 더 있다. PostgreSQL 19 GA가 11월 19일로 잡혀 있다(추가 RC가 필요하면 미뤄진다). RC 2에서는 표현식 인덱스, 생성 컬럼, 파티션 키 안에서 배열·복합·범위 타입에 `JSON_ARRAY()`/`JSON_OBJECT()`를 쓰는 기능이 되돌려졌다. 19를 시험하면서 이런 객체를 만들었다면 업그레이드 전에 지우거나 다시 정의해야 한다.

### 점검 목록

- 운영 클러스터의 버전을 `SELECT version();`으로 확인하고 이번 마이너로 올린다
- GIN, `gist_trgm_ops`, 길이 없는 `bpchar` 인덱스를 찾아 `REINDEX` 일정을 잡는다
- 증분 백업을 쓰면 업데이트 직후 전체 백업을 새로 받는다
- 파티션 테이블의 `NOT NULL NO INHERIT` 제약을 위 쿼리로 확인한다
- 14를 쓰는 DB가 있다면 메이저 업그레이드 계획을 잡는다

## 참고 자료

- [PostgreSQL 18.7, 17.12, 16.16, 15.20, 14.25, and 19 RC 2 Released! (PostgreSQL)](https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/)
- [Release 18.7 (PostgreSQL 문서)](https://www.postgresql.org/docs/18/release-18-7.html)
