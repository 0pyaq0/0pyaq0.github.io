---
title: "Java4Shell(CVE-2026-114938): JDK Base64 인트린직 취약점과 Kafka 쪽 대응"
description: "x86-64의 AVX-512 VBMI 인트린직을 쓰는 JDK Base64 디코딩에서 취약점이 나왔다. Apache Kafka 프로젝트가 낸 대응 글을 기준으로 영향 범위, 수정 버전, JVM 플래그 우회 방법을 정리했다."
date: 2026-11-24T09:40:00
update: 2026-11-24T09:40:00
tags:
  - Java
  - Security
---

11월 19일 Apache Kafka 블로그에 CVE-2026-114938, 별칭 "Java4Shell" 대응 글이 올라왔다. 이름은 Kafka 글에 붙었지만 문제는 Kafka 코드가 아니라 JDK에 있다. OpenJDK가 x86-64 CPU에서 Base64 디코딩을 빠르게 하려고 쓰는 AVX-512 VBMI 인트린직이 원인이다. 그래서 Kafka 버전을 올릴 필요는 없고 JDK를 올려야 한다. 거꾸로 말하면 Kafka를 쓰지 않아도 같은 JDK 위에서 도는 Java 서비스라면 같은 조건을 확인해 볼 만하다.

> 우리 JVM이 영향 범위에 들어가는지, 패치 전까지 무엇으로 막을 수 있는지 어떻게 확인할까?

> 이 글은 Apache Kafka 블로그의 대응 글을 읽고 정리했다. 글에 링크된 NVD 페이지는 내용을 읽지 못했고, OpenJDK나 JDK 벤더 권고문은 글에 연결되어 있지 않아 다루지 않는다. CVSS 점수와 공격 경로도 원문에 없어서 적지 않았다.

## 1. 영향받는 조건

Kafka 글은 두 조건이 **동시에** 맞아야 영향을 받는다고 적는다.

- 영향받는 Java 버전에서 실행된다.
- AVX-512 VBMI를 지원하는 x86-64 CPU에서 실행된다.

Java 8, Java 11, ARM64 머신은 영향이 없다. Kafka 안에서는 브로커, 컨트롤러, Kafka Connect 워커, Kafka Streams 애플리케이션, 클라이언트가 모두 대상이다. 브로커만 보고 끝내면 안 되고, Kafka 클라이언트를 쓰는 일반 백엔드 서비스도 같은 기준으로 봐야 한다는 뜻이다.

버전별 범위는 다음과 같다.

| Java             | 영향 범위            | 수정 버전                |
| ---------------- | -------------------- | ------------------------ |
| 17               | `17.0.6` ~ `17.0.21` | `17.0.21.1`              |
| 21               | `21` ~ `21.0.13`     | `21.0.13.1`              |
| 25               | `25` ~ `25.0.5`      | `25.0.5.1`               |
| 27               | `27` ~ `27.0.1`      | `27.0.1.1`               |
| 18~20, 22~24, 26 | 전체                 | 수정 없음(업데이트 종료) |

글은 벤더마다 자체 버전 번호를 쓸 수 있으니 수정이 들어간 빌드는 벤더 권고문으로 확인하라고 덧붙인다. 개인적으로는 마지막 줄이 더 걸렸다. 26 같은 비 LTS 버전에 머물러 있다면 패치가 나오지 않으니 LTS로 옮기는 것 말고는 길이 없다.

## 2. 내 호스트가 해당하는지 보기

Java 버전은 실제로 프로세스를 띄우는 JVM에서 확인해야 한다. 빌드 이미지와 런타임 이미지가 다른 경우가 흔하다.

```bash
java -version
```

CPU 쪽은 Kafka 글에 확인 명령이 없어서, 리눅스에서 흔히 쓰는 방법으로 CPU 플래그를 확인했다. `/proc/cpuinfo`에 `avx512vbmi`가 보이면 해당 기능을 지원하는 CPU다.

```bash
grep -o -m1 'avx512vbmi' /proc/cpuinfo || echo "AVX-512 VBMI 없음"
```

클라우드에서는 같은 인스턴스 계열이라도 세대에 따라 CPU가 달라질 수 있다. 오토스케일링 그룹이나 노드 풀처럼 여러 인스턴스 타입이 섞이는 곳은 한 대만 보고 판단하지 않는 편이 낫다.

## 3. 패치 전 우회: Base64 인트린직 끄기

JDK를 바로 올릴 수 없다면 JVM 플래그로 해당 코드 경로를 끌 수 있다.

```bash
export KAFKA_OPTS="-XX:-UseBASE64Intrinsics"
bin/kafka-server-start.sh config/server.properties
```

`KAFKA_OPTS`에 이미 JAAS 파일 경로 같은 값이 있으면 덮어쓰지 말고 뒤에 붙인다. 클라이언트나 Kafka Streams 애플리케이션이라면 그 애플리케이션의 JVM 옵션에 넣는다. 일반 Spring Boot 서비스라면 `JAVA_TOOL_OPTIONS`나 실행 스크립트의 `java` 인자에 같은 플래그를 주는 식이 된다.

플래그가 실제로 먹었는지는 HotSpot 플래그 출력으로 확인할 수 있다.

```bash
java -XX:-UseBASE64Intrinsics -XX:+PrintFlagsFinal -version | grep UseBASE64Intrinsics
```

### UseAVX=2는 왜 권하지 않나

글에는 `-XX:UseAVX=2`도 영향받는 코드를 피한다고 나온다. 다만 AVX-512 사용 전체를 끄고, ARM의 JVM은 이 플래그를 거부해서 기동에 실패한다. `-XX:-UseBASE64Intrinsics`는 두 아키텍처 모두에서 동작한다. x86과 ARM 노드가 섞인 클러스터라면 차이가 크다.

| 플래그                     | 끄는 범위         | ARM에서       |
| -------------------------- | ----------------- | ------------- |
| `-XX:-UseBASE64Intrinsics` | Base64 인트린직만 | 동작          |
| `-XX:UseAVX=2`             | AVX-512 전체      | JVM 기동 실패 |

## 4. 컨테이너 이미지

`apache/kafka` 이미지는 지금까지 나온 모든 태그에 영향받는 Java 버전이 들어 있다고 한다. 글에 나온 예로는 4.4.0이 Temurin 25.0.4.1, 4.3.2가 Temurin 21.0.12.1을 쓴다. 이미지 안의 버전은 이렇게 확인한다.

```bash
docker run --rm --entrypoint java apache/kafka:4.4.0 -version
```

새 이미지가 나오기 전까지는 환경 변수로 플래그를 넘긴다.

```bash
docker run -e KAFKA_OPTS="-XX:-UseBASE64Intrinsics" apache/kafka:4.4.0
```

GraalVM 네이티브 실행 파일을 쓰는 `apache/kafka-native` 이미지는 영향이 없다.

### 점검 목록

- [ ] 운영 중인 JVM 버전을 런타임 기준으로 모았는가
- [ ] 해당 호스트의 CPU가 AVX-512 VBMI를 지원하는지 확인했는가
- [ ] 패치 전까지 `-XX:-UseBASE64Intrinsics`를 적용했는가
- [ ] Kafka 클라이언트를 쓰는 서비스까지 범위에 넣었는가
- [ ] 업데이트가 끝난 비 LTS JDK를 LTS로 옮길 계획이 있는가

## 참고 자료

- [Mitigating CVE-2026-114938 ("Java4Shell") in Apache Kafka deployments](https://kafka.apache.org/blog/2026/11/19/mitigating-cve-2026-114938-java4shell-in-apache-kafka-deployments/)
