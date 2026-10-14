---
title: "PostgreSQL JDBC 42.7.14 보안 업데이트: requireAuth 무시와 패딩 데이터 노출, 두 CVE 정리"
description: "pgjdbc 42.7.14에서 고쳐진 CVE-2026-107314, CVE-2026-107315를 GitHub 보안 권고 기준으로 정리했다. 어떤 버전과 설정이 영향을 받는지, 업그레이드 전에 쓸 수 있는 우회책과 확인 방법을 적었다."
date: 2026-10-14T09:35:00
update: 2026-10-14T09:35:00
tags:
  - Java
  - PostgreSQL
  - Security
---

PostgreSQL JDBC 드라이버(pgjdbc) 42.7.14가 나왔다. 보안 수정 두 건만 담은 릴리스다. 하나는 `requireAuth` 설정이 특정 값일 때 아예 적용되지 않는 문제이고, 다른 하나는 값을 선언 길이보다 짧게 보내면 같은 커넥션에서 앞서 보낸 SQL과 파라미터 바이트가 패딩으로 섞여 저장되는 문제다. 둘 다 심각도는 Moderate지만, 커넥션 풀을 쓰는 Spring 서버라면 다른 요청의 데이터가 섞일 수 있다는 점에서 두 번째가 꽤 신경 쓰인다. 42.7.4 이상을 쓰고 있다면 대부분 해당된다.

> 우리 서비스가 쓰는 pgjdbc 버전과 설정이 이번 CVE에 해당하는가, 바로 못 올리면 무엇을 해 둘 수 있나?

> 이 글은 PostgreSQL 공식 뉴스, pgjdbc 42.7.14 릴리스 노트, 각 CVE의 GitHub 보안 권고(GHSA)를 읽고 정리했다.

## 1. 두 CVE 한눈에 보기

| 항목      | CVE-2026-107314               | CVE-2026-107315                  |
| --------- | ----------------------------- | -------------------------------- |
| 문제      | `requireAuth`가 적용되지 않음 | 패딩에 이전 메시지 바이트가 섞임 |
| 영향 버전 | 42.7.11 ~ 42.7.13             | 42.7.4 ~ 42.7.13                 |
| CVSS      | 5.9 (Moderate)                | 5.3 (Moderate)                   |
| 수정 버전 | 42.7.14                       | 42.7.14                          |

두 문제 모두 42.7.14에서 고쳐졌고, 이 릴리스에는 다른 변경이 없다. 기능 변화 걱정 없이 올릴 수 있는 버전이라는 뜻이다.

## 2. requireAuth가 조용히 무시되던 문제

`requireAuth`는 서버가 요구하는 인증 방식 중 드라이버가 받아들일 것을 제한하는 커넥션 속성이다. 문제는 드라이버가 아는 여섯 가지 방식을 전부 제외하는 값을 줬을 때다.

```text
requireAuth=!password,!md5,!gss,!sspi,!scram-sha-256,!none
```

보안 권고에 따르면 이 경우 드라이버가 제한을 하나도 걸지 않았다. 원인은 `AuthMethod.parseRequireAuth`가 속성이 없을 때와 허용할 방식이 하나도 없을 때 둘 다 `null`을 돌려주고, `checkAuth`가 `null`을 "제한 없음"으로 처리한 데 있다. `requireAuth=,`처럼 방식이 하나도 없는 값도 마찬가지였다.

결과적으로 서버가 평문 `password` 인증을 요청해도 드라이버가 받아들인다. 애플리케이션과 DB 사이에 끼어든 공격자가 평문 인증을 요구하면 DB 비밀번호를 받아 갈 수 있다는 얘기다. 개인적으로 더 걸린 부분은 **이렇게 잘못 설정된 커넥션이 평소에는 정상 동작한다**는 점이다. 설정 실수가 있어도 겉으로 드러나지 않는다.

영향 범위는 좁은 편이다.

- `requireAuth=scram-sha-256` 같은 허용 목록, `!password,!md5` 같은 일부 제외는 정상 적용된다.
- 속성에 기본값이 없어서 아예 쓰지 않는 서비스는 상관없다.

  42.7.14로 올리면 이런 값은 SQLState `08004`("Authentication method is not allowed by requireAuth")로 거부되고, 방식이 하나도 없는 값은 `22023`으로 실패한다. 업그레이드 후 연결이 안 된다면 설정이 잘못돼 있었다는 신호다.

## 3. 패딩에 이전 SQL이 섞이던 문제

두 번째는 조금 더 기묘하다. 값을 선언한 길이보다 짧게 보내면 드라이버가 모자란 부분을 채우는데, 42.7.3까지는 0으로 채웠다. 42.7.4부터는 같은 커넥션에서 **앞서 보낸 메시지의 바이트**로 채우고 있었다. `PgBufferedOutputStream.writeZeros`가 버퍼가 비어 있는 상태에서 들어오면 0으로 지우지 않은 게 원인이다.

선언 길이를 받는 진입점은 이렇다.

- `PreparedStatement.setObject(int, ByteStreamWriter)`
- `CopyIn.writeToCopy(ByteStreamWriter)`, `CopyIn.writeToCopy(byte[], int, int)`
- 64KiB를 넘는 `PGCopyOutputStream.write(byte[], int, int)`
- `LargeObject.write(byte[], int, int)`
- `java.sql.Blob.setBytes(long, byte[], int, int)`

어느 경우든 드라이버는 오류 없이 호출을 받는다. 기본 `maxSendBufferSize`가 8192바이트라 값 하나에 최대 그만큼의 이전 트래픽이 들어갈 수 있고, GSS 암호화 연결(`gssEncMode`)에서는 최대 16320바이트까지 늘어난다.

커넥션 풀 환경이라 더 문제다. 권고문에 따르면 패딩 안에 다른 요청이 같은 커넥션으로 보낸 SQL 텍스트와 파라미터 값이 들어갈 수 있다. 그 값을 저장하고 다시 읽을 수 있는 사용자라면 남의 요청 내용을 볼 수 있게 된다. 그리고 이미 영향 버전으로 저장된 값에는 그 데이터가 그대로 남아 있다. 드라이버를 올려도 과거에 저장된 BLOB이나 Large Object는 따로 봐야 한다.

이 문제를 끄는 커넥션 속성은 없다. 권고문이 말하는 우회책은 선언 길이와 실제 데이터 길이를 맞추는 것뿐이고, 올바르게 작성된 애플리케이션은 영향을 받지 않는다고 적혀 있다.

## 4. 바로 못 올릴 때 쓸 수 있는 우회책

`requireAuth` 쪽은 설정으로 막을 수 있다.

```properties
# 전부 제외하는 값 대신 허용할 방식을 직접 적는다
spring.datasource.url=jdbc:postgresql://db.internal:5432/app?requireAuth=scram-sha-256&sslmode=verify-full
```

- 허용 목록(`requireAuth=scram-sha-256`)은 영향 받는 모든 버전에서 제대로 동작한다.
- SCRAM over TLS를 쓴다면 `channelBinding=require`가 평문 `password`를 포함한 SCRAM 외 방식을 거부한다. 서버가 `SCRAM-SHA-256-PLUS`를 제공해야 해서 md5, GSS, SSPI 환경에서는 못 쓴다.
- 이와 별개로 `sslmode=verify-full`로 신뢰하는 CA에 대해 서버를 검증하면 가짜 서버로 붙는 경로 자체를 막는다.

패딩 문제는 코드에서 선언 길이와 실제 길이가 어긋나는 곳을 찾는 수밖에 없다. 위 진입점을 쓰는 코드가 많지 않다면 grep으로 먼저 범위를 좁혀 보는 게 빠르다.

## 5. 우리 서비스에서 확인할 것

먼저 실제로 쓰고 있는 버전부터 본다. Spring Boot는 의존성 관리로 pgjdbc 버전을 정해 주니까 직접 선언하지 않았어도 확인이 필요하다.

```bash
# Gradle
./gradlew dependencyInsight --dependency org.postgresql:postgresql

# Maven
mvn dependency:tree -Dincludes=org.postgresql:postgresql
```

그다음 점검할 것만 추리면 이렇다.

- 버전이 42.7.4 ~ 42.7.13이면 42.7.14로 올리기. Boot BOM이 아직 올려 주지 않았다면 버전을 직접 지정
- 설정 파일과 환경 변수에서 `requireAuth` 값을 검색해 전부 제외하는 형태가 있는지
- `sslmode`가 `verify-full`인지
- `ByteStreamWriter`, `CopyIn`, `LargeObject`, `Blob.setBytes`를 쓰는 코드에서 선언 길이를 따로 넘기는 곳
- 그런 경로로 저장된 기존 데이터를 다시 점검할지

요즘은 `requireAuth`를 쓰는 서비스가 많지 않을 테니 실제로 손이 많이 갈 쪽은 버전 업그레이드와 COPY·BLOB 코드 확인일 것 같다.

## 참고 자료

- [PostgreSQL JDBC 42.7.14 Security update for multiple CVE's (PostgreSQL News)](https://www.postgresql.org/about/news/2026-10-07-postgresql-jdbc-42714-security-update-for-multiple-cves-3399/)
- [pgjdbc 42.7.14 릴리스 노트](https://jdbc.postgresql.org/changelogs/2026-10-07-42.7.14-release/)
- [GHSA-rhp9-mr79-r74h: requireAuth is silently not enforced](https://github.com/pgjdbc/pgjdbc/security/advisories/GHSA-rhp9-mr79-r74h)
- [GHSA-f64h-wr5q-3qf3: padding with bytes of earlier statements](https://github.com/pgjdbc/pgjdbc/security/advisories/GHSA-f64h-wr5q-3qf3)
