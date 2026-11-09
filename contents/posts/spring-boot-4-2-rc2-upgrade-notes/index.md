---
title: "Spring Boot 4.2.0-RC2 업그레이드 노트: Redis 데이터베이스, 프록시 헤더, SSL 번들이 조용히 바뀐다"
description: "Spring Boot 4.2.0-RC2 릴리스 노트의 업그레이드 항목을 정리했다. Redis master/replica 설정, WebFlux의 X-Forwarded-Prefix, SSL 번들 옵션, RabbitMQ AMQP 1.0 기본값이 4.1과 다르게 동작한다."
date: 2026-11-09T09:40:00
update: 2026-11-09T09:40:00
tags:
  - Spring
  - Java
---

11월 6일 **Spring Boot 4.2.0-RC2**가 Maven Central에 올라왔다. 공지에 따르면 기능 개선, 문서, 의존성 업그레이드, 버그 수정을 합쳐 99건이 들어갔다. RC 단계라 새 기능보다 눈여겨볼 건 릴리스 노트의 "4.1에서 업그레이드" 항목이다. 이번 RC2에서는 설정값이 무시되던 버그를 고치면서 동작이 바뀐 곳이 여럿이다. 그동안 설정해 놓고 효과가 없던 값이 이제 적용된다는 뜻이라, 4.2로 올리는 순간 예상과 다르게 동작할 수 있다.

> 4.1에서 4.2로 올릴 때 RC2 기준으로 어떤 설정을 다시 봐야 하는가?

> 이 글은 Spring 블로그의 RC2 공지와 GitHub 위키의 4.2.0-RC2 릴리스 노트를 읽고 정리했다. RC라서 GA 전에 바뀔 수 있다. 앞선 마일스톤(M1, M2, RC1)의 변경은 다루지 않았다.

## 1. Redis: 무시되던 데이터베이스 번호가 적용된다

`spring.data.redis.masterreplica.nodes`로 master/replica 구성을 쓰는 경우, 지금까지는 `spring.data.redis.database`(또는 `spring.data.redis.url`의 데이터베이스 부분)가 무시됐다. 4.2부터는 이 값이 적용된다.

문제는 그동안 이 설정을 넣어 두고도 실제로는 0번 DB에 쓰고 있던 서비스다. 업그레이드하면 다른 번호의 DB로 붙게 되고, 기존 키가 안 보이는 것처럼 동작한다. 릴리스 노트는 0번을 유지하려면 속성을 지우거나 0으로 두라고 안내한다.

```yaml
spring:
  data:
    redis:
      database: 0 # master/replica 구성에서 기존 동작을 유지하려면 0으로 둔다
      masterreplica:
        nodes: redis-1:6379,redis-2:6379
```

개인적으로는 이 항목이 가장 걸렸다. 설정 파일에는 원래 의도대로 적혀 있으니 리뷰로는 잡기 어렵고, 배포 후 데이터가 사라진 것처럼 보이는 종류의 문제다.

## 2. WebFlux와 X-Forwarded-Prefix

WebFlux에서 프록시 헤더 처리가 바뀌었다.

| 전략        | 4.2 기본 동작                       | 되돌리는 속성                                           |
| ----------- | ----------------------------------- | ------------------------------------------------------- |
| `native`    | 접두사 헤더를 컨텍스트 경로에 안 씀 | `server.netty.forwarded-headers.use-forwarded-prefix`   |
| `framework` | 접두사 헤더를 컨텍스트 경로에 안 씀 | `spring.webflux.forwarded-headers.use-forwarded-prefix` |

`server.forward-headers-strategy=native`일 때 Reactor Netty가 더 이상 `X-Forwarded-Prefix`를 컨텍스트 경로로 쓰지 않는다. `framework` 전략도 WebFlux에서는 같다. 두 속성 중 해당하는 쪽을 `true`로 두면 이전처럼 동작한다.

게이트웨이 뒤에서 `/api` 같은 접두사를 붙여 라우팅하고 있다면 리다이렉트 URL이나 링크 생성 결과를 확인해 볼 만하다.

```yaml
server:
  forward-headers-strategy: native
  netty:
    forwarded-headers:
      use-forwarded-prefix: true
```

## 3. SSL 번들 옵션: 이제 시작 단계에서 실패한다

SSL 번들의 `options.ciphers`, `options.enabled-protocols`가 일부 컴포넌트에서 조용히 무시되고 있었다. 릴리스 노트가 꼽은 대상은 이렇다.

- gRPC 클라이언트와 서버
- LDAP 클라이언트와 임베디드 LDAP 서버
- OTLP 트레이싱·로깅 익스포터

  4.2부터는 이런 컴포넌트에 옵션이 들어간 번들을 쓰면 **애플리케이션이 시작 단계에서 실패한다**. 하나의 SSL 번들을 HTTP 서버와 OTLP 익스포터에 같이 쓰고 있었다면 걸린다. 옵션을 빼거나, 옵션 없는 번들을 따로 만들어 해당 컴포넌트에 연결해야 한다. LDAP 클라이언트는 SSL 번들 리로드도 더 이상 지원하지 않는다.

## 4. RabbitMQ AMQP 1.0 기본값

4.2.0-M1에서 들어온 RabbitMQ AMQP 1.0 지원이 다듬어지면서 기본값이 바뀌었다.

| 속성                                        | 이전 기본값 | RC2             |
| ------------------------------------------- | ----------- | --------------- |
| `spring.amqp.rabbitmq.username`, `password` | `guest`     | 없음, 익명 연결 |
| `template.exchange`, `template.routing-key` | 빈 문자열   | 기본값 없음     |

`spring.amqp.rabbitmq.ssl.bundle`을 지정하면 포트 기본값은 `5671`이 된다. 헬스 인디케이터 키도 `rabbit`에서 `amqprabbit`으로 바뀌었다. 끄려면 `management.health.amqprabbit.enabled`를 쓰고, 헬스 그룹에 `rabbit`을 넣어 뒀다면 이름을 바꿔야 한다.

그 밖에 `management.observations.conventions`를 `open-telemetry`로 설정하면 이제 실제로 OpenTelemetry 시맨틱 컨벤션이 적용된다. 이전에는 이 값을 넣어도 어느 컨벤션도 적용되지 않았다고 한다. 메트릭 이름과 태그가 달라질 수 있으니 대시보드를 확인해 둘 만하다.

## 5. 함께 올라간 의존성

릴리스 노트가 꼽은 주요 의존성 버전이다. 전체 목록은 아니다.

| 구분     | 의존성           | 버전           |
| -------- | ---------------- | -------------- |
| Spring   | Spring Framework | `7.1.0-RC2`    |
| Spring   | Micrometer       | `1.18.0-RC2`   |
| 서드파티 | Hibernate        | `7.4.14.Final` |
| 서드파티 | Jackson BOM      | `3.1.8`        |
| 서드파티 | Netty            | `4.2.20.Final` |

이번 RC2에서 새로 폐기(deprecated)된 항목은 없다.

### 점검 목록

- master/replica Redis 구성에 `database` 값이 0이 아닌 채로 들어가 있는지 확인한다
- WebFlux 서비스가 `X-Forwarded-Prefix`에 기대고 있는지 본다
- gRPC, LDAP, OTLP에 옵션이 있는 SSL 번들을 쓰는지 확인한다
- RabbitMQ AMQP 1.0 클라이언트의 계정과 기본 exchange를 명시한다
- 헬스 그룹과 프로브 설정의 `rabbit` 키를 `amqprabbit`으로 바꾼다
- 관측 컨벤션을 바꿨다면 메트릭 대시보드를 다시 본다

## 참고 자료

- [Spring Boot 4.2.0-RC2 available now](https://spring.io/blog/2026/11/06/spring-boot-4-2-0-RC2-available-now)
- [Spring Boot 4.2.0-RC2 Release Notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.2.0-RC2-Release-Notes)
