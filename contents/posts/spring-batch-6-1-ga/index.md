---
title: "Spring Batch 6.1 GA: @JobParameter가 생겼고 빌더 몇 개는 컴파일이 깨진다"
description: "11월 19일 나온 Spring Batch 6.1은 @JobParameter, PageableItemReader 같은 편의 기능과 함께 소스·바이너리 호환이 깨지는 변경 네 가지를 담았다. 공식 블로그와 What's new 문서를 기준으로 업그레이드 전에 볼 것을 정리했다."
date: 2026-11-20T09:40:00
update: 2026-11-20T09:40:00
tags:
  - Spring
  - Java
---

Spring Batch 6.1이 11월 19일 GA로 나왔다. 마이너 버전이지만 버전만 올리면 안 된다. 공식 블로그가 직접 "a few breaking changes"라고 적었고, 그중 빌더 반환 타입 변경은 소스와 바이너리 호환이 모두 깨진다. 대신 잡 파라미터를 SpEL 없이 주입하는 `@JobParameter`가 생겼고, 재시작할 때 잡 이력이 쌓일수록 느려지던 문제가 정리됐다.

> 6.0에서 6.1로 올릴 때 무엇이 깨지고, 무엇을 새로 쓸 만할까?

> 이 글은 Spring 공식 블로그의 6.1 GA 발표와 레퍼런스 문서의 What's new 페이지를 읽고 정리했다. Java와 Spring Boot 기준 버전은 두 문서 모두 적어 두지 않아서 다루지 않는다.

## 1. 먼저 볼 것: 깨지는 변경 네 가지

블로그와 What's new 문서가 같은 네 항목을 breaking change로 꼽는다.

| 변경                                    | 영향받는 코드                                    | 대응                                |
| --------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| 상호 배타적인 빌더 메서드 분리          | 빌더 반환값을 빌더 타입 변수에 담는 코드         | 체인으로 이어 쓰거나 변수 타입 수정 |
| Avro 리플렉션 직렬화에 신뢰 클래스 필요 | `SpecificRecord`나 일반 Java 타입을 쓰는 Avro 잡 | 신뢰 패키지 지정                    |
| JDBC DAO 기본 생성자 제거               | DAO를 직접 생성하는 코드                         | `JdbcClient`를 받는 생성자 사용     |
| `JsonLineMapper` 원시 타입 변경         | `JsonLineMapper`를 직접 쓰는 코드                | 언마샬러를 넘기는 생성자로 교체     |

### 빌더 반환 타입

`FlatFileItemReaderBuilder`의 `targetType(Class)`와 `fieldSetMapper(...)`처럼 같이 쓰면 안 되는 메서드들이 이제 단계별 DSL로 나뉜다. `FlatFileItemWriterBuilder`의 `delimited()`와 `formatted()`, `JdbcBatchItemWriterBuilder`의 `columnMapped()`와 `beanMapped()`도 같은 처리를 받았다. 다만 빌더를 중간에 변수로 받아 조건에 따라 메서드를 붙이던 코드는 컴파일이 안 된다.

### Avro

`AvroItemReader`, `AvroItemWriter`로 `SpecificRecord`나 일반 Java 타입을 다루는 잡은 신뢰 클래스로 등록하지 않으면 런타임에 실패한다. Avro 1.12.2로 올라가면서 생긴 변화다. 문서가 안내하는 방법은 시스템 프로퍼티다.

```bash
java -Dorg.apache.avro.SERIALIZABLE_PACKAGES=com.example.domain -jar batch-app.jar
```

`org.apache.avro.SERIALIZABLE_CLASSES`로 클래스 단위 지정도 된다. 컴파일에서 드러나지 않아 가장 놓치기 쉽다.

### JDBC DAO와 JsonLineMapper

JDBC DAO는 내부가 `JdbcClient` 기반으로 바뀌었고 기본 생성자가 없어졌다. 직접 만들던 코드는 아래처럼 바꾼다.

```java
JdbcJobInstanceDao jobInstanceDao = new JdbcJobInstanceDao(JdbcClient.create(dataSource));
```

`JsonLineMapper`는 특정 JSON 라이브러리에 묶이지 않도록 언마샬러를 받는다.

```java
.lineMapper(new JsonLineMapper<>(new JacksonJsonObjectUnmarshaller<>(Trade.class)))
```

기본 생성자와 `JsonMapper` 생성자는 7.0에서 제거될 예정이다.

## 2. 새로 쓸 만한 기능

### @JobParameter

스텝 스코프 빈마다 쓰던 `@Value("#{jobParameters['inputFile']}")`를 대신한다.

```java
@Bean
@StepScope
public FlatFileItemReader<Foo> fooReader(@JobParameter String inputFile) {
    // ...
}
```

이름을 생략하면 파라미터 이름을 쓰기 때문에 `-parameters` 컴파일 옵션이 필요하다. 파라미터가 없으면 `null`이 들어간다.

### PageableItemReader

`RepositoryItemReader`의 타입 안전한 대안으로, 메서드 이름 문자열 대신 메서드 참조를 쓴다.

```java
PageableItemReader<Customer> reader = new PageableItemReaderBuilder<Customer>()
        .query(customerRepository::findAll)
        .sort(Sort.by(Sort.Direction.ASC, "id"))
        .pageSize(100)
        .name("customerReader")
        .build();
```

### 그 밖에

- `MultiResourceItemReaderBuilder`가 `classpath:data/input/file-*.txt` 같은 위치 패턴을 받는다.
- `RepositoryItemWriter`에 `setMethodName("saveAllAndFlush")`를 주면 청크마다 flush한다.
- `AsyncItemProcessor`, `AsyncItemWriter`, `ChunkTaskExecutorItemWriter`가 `spring-batch-core`로 옮겨왔다. `spring-batch-integration` 쪽 클래스는 deprecated 하위 클래스로 남는다.

## 3. 재시작 성능

개인적으로는 이 부분이 가장 실무에 와닿았다. 블로그에 따르면 재시작 비용이 더 이상 잡 이력 크기에 비례하지 않는다. `JdbcJobExecutionDao#findJobExecutions`는 실행 N개에 대해 1 + 3N번 날리던 쿼리가 2번으로 줄었다. 파티션 837개짜리 스텝 예시에서는 `StepExecution` 객체가 837 × 837개 만들어지던 것이 837개로 줄었다. 일부 수정은 6.0.6에도 들어갔다고 한다.

## 4. 7.0을 앞둔 deprecation

What's new 문서는 7.0에서 지울 항목들을 나열한다. 자주 쓰일 만한 것만 추렸다.

| 대상                                       | 대체                                              |
| ------------------------------------------ | ------------------------------------------------- |
| Apache Derby 지원                          | 다른 DB로 이전                                    |
| `getJobInstanceCount(String)`              | `countJobInstances(String)`                       |
| `RepositoryItemReader#setSorts(Map)`       | `PageableItemReader` 검토                         |
| `spring-batch-integration`의 비동기 클래스 | `org.springframework.batch.core.step.item` 패키지 |

테스트에서 Derby를 임베디드 DB로 쓰고 있다면 이번에 H2 등으로 바꿔 두는 편이 낫다.

### 점검 목록

- [ ] 리더·라이터 빌더를 변수로 받아 조립하는 코드가 있는가
- [ ] Avro 리더·라이터를 쓰면 신뢰 패키지를 지정했는가
- [ ] JDBC DAO나 `JsonLineMapper`를 직접 생성하는 곳이 있는가
- [ ] `@JobParameter`로 바꿀 때 `-parameters` 컴파일 옵션이 켜져 있는가
- [ ] Derby와 deprecated 카운트 메서드를 쓰는 곳이 있는가

## 참고 자료

- [Spring Batch 6.1 is now GA!](https://spring.io/blog/2026/11/19/spring-batch-6-1-0-available-now)
- [Spring Batch 6.1 What's new](https://docs.spring.io/spring-batch/reference/6.1/whatsnew.html)
