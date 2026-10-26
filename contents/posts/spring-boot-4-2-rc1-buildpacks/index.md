---
title: "Spring Boot 4.2.0-RC1: 기본 빌드팩 이미지가 Ubuntu 26.04로, 셸 없는 런 이미지로 바뀐다"
description: "10월 23일 나온 Spring Boot 4.2.0-RC1의 변경점 중 build-image 기본 builder 교체와 properties migrator의 실패 옵션을 릴리스 노트와 공식 문서 기준으로 정리했다."
date: 2026-10-26T09:40:00
update: 2026-10-26T09:40:00
tags:
  - Spring
  - Java
  - DevOps
---

Spring Boot 4.2.0-RC1이 10월 23일 나왔다. 변경 113건 중 운영에 바로 닿는 건 `bootBuildImage`, `spring-boot:build-image`의 기본 builder 교체다. 기본 이미지가 Ubuntu 24.04에서 26.04 기반으로 바뀌고, builder를 따로 지정하지 않으면 **셸이 없는 런 이미지**가 쓰인다. 컨테이너 안에서 `sh`로 헬스체크를 돌리거나 디버깅용으로 셸에 들어가던 팀이라면 4.2로 올리는 순간 동작이 달라질 수 있다. 아직 RC라 정식 출시 전에 바뀔 여지는 있지만, 미리 확인해 두면 업그레이드가 덜 놀랍다.

> 4.2로 올리면 컨테이너 이미지에서 무엇이 달라지고, 기존 동작을 유지하려면 무엇을 설정하나?

> 이 글은 spring.io의 4.2.0-RC1 공지, GitHub 위키의 RC1 릴리스 노트, Spring Boot 4.2 업그레이드 문서를 확인해 정리했다. RC 단계의 릴리스 노트라 의존성 버전과 지원 중단 목록은 아직 비어 있다.

## 1. 공지에 나온 변경점

공지가 꼽은 항목은 세 가지다.

- 기본 Buildpacks builder가 `paketobuildpacks/ubuntu-resolute-builder`(Ubuntu 26.04 기반)로 바뀌었다.
- `spring-boot-properties-migrator`가 오류나 경고가 있을 때 애플리케이션 기동을 실패시킬 수 있게 됐다.
- 실행 가능한 jar에서 클래스와 리소스 조회가 빨라져 기동 성능이 개선됐다.

세 번째는 수치가 공개되지 않아서 따로 적을 게 없다. 앞의 두 가지를 차례로 정리한다.

## 2. 빌드팩 builder 교체

릴리스 노트를 보니 바뀐 범위가 생각보다 넓다.

| 항목                        | 4.1까지                                    | 4.2.0-RC1                                                   |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| 기본 builder                | `paketobuildpacks/builder-noble-java-tiny` | `paketobuildpacks/ubuntu-resolute-builder`                  |
| 기반 OS                     | Ubuntu 24.04                               | Ubuntu 26.04                                                |
| builder 미지정 시 런 이미지 | -                                          | `paketobuildpacks/ubuntu-resolute-run-tiny:latest`(셸 없음) |
| builder 지정 시 런 이미지   | -                                          | builder 메타데이터의 `ubuntu-resolute-run:latest`(셸 있음)  |

같은 새 builder를 쓰더라도 **builder를 명시했는지에 따라 런 이미지가 달라진다**는 점이 헷갈리기 쉽다. 설정을 안 건드린 프로젝트는 셸 없는 `run-tiny`를 받고, builder를 직접 적어 둔 프로젝트는 셸이 있는 `run`을 받는다.

하나 더 있다. 새 builder는 런 이미지 버전을 고정하지 않는다. 같은 소스로 다시 빌드해도 런 이미지가 달라질 수 있다는 뜻이고, 릴리스 노트는 재현 가능한 빌드가 필요하면 `builder`와 `runImage`를 둘 다 특정 버전으로 지정하라고 권한다.

기존 builder를 그대로 쓰고 싶다면 `builder`를 예전 값으로 되돌리면 된다. Gradle 기준으로는 이렇다.

```groovy
tasks.named("bootBuildImage") {
    builder = "paketobuildpacks/builder-noble-java-tiny"
}
```

Maven은 플러그인 설정의 `image` 아래에 둔다.

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <image>
            <builder>paketobuildpacks/builder-noble-java-tiny</builder>
        </image>
    </configuration>
</plugin>
```

런 이미지 호환성 검사 방식도 바뀌었다. 지원 중단된 stack ID 대신 `io.buildpacks.base.distro.` 라벨의 OS 배포판 정보를 비교하고, 없으면 `io.buildpacks.stack.distro.` 라벨로 대체한다. 이름이나 버전이 다르면 경고를 남긴다. 예를 들어 새 기본 builder에 `paketobuildpacks/ubuntu-noble-run`을 런 이미지로 섞어 쓰면 경고가 뜬다.

## 3. properties migrator를 CI에서 실패시키기

`spring-boot-properties-migrator`는 이름이 바뀌었거나 사라진 설정 속성을 기동 시점에 찾아 로그로 알려 주고, 런타임에 임시로 옮겨 주는 모듈이다. 지금까지는 로그만 남기니 놓치기 쉬웠다. 4.2 문서에 `spring.properties.migrator.fail` 속성이 추가됐다.

| 값           | 동작                                          |
| ------------ | --------------------------------------------- |
| `never`      | 실패시키지 않음(기본값)                       |
| `on-error`   | 더 이상 지원하지 않는 속성이 있으면 기동 실패 |
| `on-warning` | 이름이 바뀐 속성까지 있으면 기동 실패         |

```yaml
spring:
  properties:
    migrator:
      fail: on-warning
```

개인적으로는 이 옵션이 업그레이드 작업에서 더 쓸모 있어 보였다. 테스트 프로필에만 `on-warning`을 걸어 두면, 옛 속성 이름이 남은 설정 파일을 통합 테스트가 잡아낸다. 다만 `@PropertySource`처럼 나중에 환경에 추가되는 속성은 검사 대상이 아니다. 마이그레이션이 끝나면 이 모듈은 의존성에서 빼라는 안내도 그대로다.

## 4. 올리기 전에 볼 것

- 컨테이너 헬스체크, 엔트리포인트, 디버깅 절차가 이미지 안의 셸에 기대고 있지 않은지
- `builder`를 명시하지 않은 프로젝트가 셸 없는 런 이미지로 바뀌는 걸 받아들일 수 있는지
- 재현 가능한 빌드가 필요하면 `builder`와 `runImage`를 버전까지 고정했는지
- Ubuntu 26.04 기반으로 바뀌면서 이미지에 의존하는 네이티브 라이브러리가 달라지지 않는지
- 업그레이드 브랜치의 테스트 프로필에 `spring.properties.migrator.fail`을 걸어 둘지
- 4.2.0-RC1 Configuration Changelog로 바뀐 속성 전체를 한 번 훑었는지

## 참고 자료

- [Spring Boot 4.2.0-RC1 available now (spring.io)](https://spring.io/blog/2026/10/23/spring-boot-4-2-0-RC1-available-now)
- [Spring Boot 4.2.0-RC1 Release Notes (GitHub Wiki)](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.2.0-RC1-Release-Notes)
- [Upgrading Spring Boot (Spring Boot 4.2 문서)](https://docs.spring.io/spring-boot/4.2/upgrading.html)
