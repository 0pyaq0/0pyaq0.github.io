---
title: "JDK 28 값 클래스 프리뷰: Integer와 LocalDate의 == 결과가 바뀔 수 있다"
description: "10월 27일 Inside.java Quality Outreach가 JDK 28의 값 클래스(JEP 401) 프리뷰에 대한 사전 안내를 냈다. 프리뷰를 켜면 JDK 클래스 30개가 값 클래스로 바뀌면서 기존 코드의 동작이 달라지는 지점을 정리했다."
date: 2026-10-28T09:40:00
update: 2026-10-28T09:40:00
tags:
  - Java
  - JDK
---

JDK 28에 값 클래스(value class, JEP 401)가 프리뷰로 들어간다. 프리뷰를 켜면 `Integer`, `Long`, `Optional`, `LocalDate` 같은 JDK 클래스 30개가 값 클래스가 되고, **코드를 한 줄도 안 바꿨는데** `==` 비교 결과나 `synchronized` 동작이 달라질 수 있다. 프리뷰를 끈 기본 상태에서는 동작이 그대로라서 당장 운영에 영향은 없다. 다만 OpenJDK 쪽이 프리뷰를 켠 상태로도 테스트해 보라고 공식적으로 요청한 만큼, 라이브러리나 프레임워크를 만드는 쪽이라면 지금 한 번 돌려 볼 만하다.

> 값 클래스 프리뷰를 켜면 기존 코드의 어디가 깨질 수 있나?

> 이 글은 10월 27일 Inside.java의 Quality Outreach Heads-up 글을 확인해 정리했다. 프리뷰 기능이라 정식 도입 전에 세부 동작이 바뀔 수 있다.

## 1. 어떤 클래스가 바뀌나

프리뷰를 켜면 아래 클래스가 값 클래스로 동작한다. **코드를 JDK 28 이전 버전이나 프리뷰 없이 컴파일했어도 적용된다.** 실행할 때 프리뷰를 켰는지가 기준이라는 뜻이다.

| 패키지             | 값 클래스가 되는 타입                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `java.lang`        | `Integer`, `Long`, `Float`, `Double`, `Byte`, `Short`, `Character`, `Boolean`, `Number`, `Record` |
| `java.util`        | `Optional`, `OptionalInt`, `OptionalLong`, `OptionalDouble`                                       |
| `java.time`        | `LocalDate`, `LocalDateTime`, `Instant`, `Duration` 등 12개                                       |
| `java.time.chrono` | `MinguoDate`, `HijrahDate`, `JapaneseDate`, `ThaiBuddhistDate`                                    |

갑자기 생긴 목록은 아니다. JDK 8부터 `Optional`과 `java.time` 클래스는 "value-based class"로 문서화돼 있었고, JDK 16에서 래퍼 클래스까지 넓어졌다. 그동안 "식별성에 기대지 말라"는 경고만 있던 것을 이번에 실제 동작으로 바꾸는 셈이다.

## 2. 동작이 달라지는 지점

### `==` 비교

값 클래스는 식별성(identity)이 없다. 같은 값을 가진 두 인스턴스를 구분할 수 없어서, `==`가 필드 값을 비교한다. 글의 예시를 그대로 옮기면 이렇다.

```java
var x = LocalDate.of(2026, 7, 31);
var y = LocalDate.of(2026, 7, 31);

var identical = x == y;
// 값 클래스가 아니면 false
// 값 클래스면 true
```

`false`가 `true`로 바뀌는 방향이라 버그를 새로 만들기보다는 숨어 있던 버그를 가리는 쪽에 가깝다. 그래도 테스트가 "다른 객체여야 한다"는 걸 `==`로 확인하고 있었다면 깨진다.

### 동기화

값 객체에는 모니터가 없다. `synchronized`로 잠글 수 없고 `wait`, `notify`도 안 된다. 컴파일 오류가 나거나 런타임에 `IdentityException`이 던져진다. 개인적으로는 이쪽이 더 걸렸다. `Integer`나 `Long`을 락 객체로 쓰는 코드는 오래전부터 나쁜 패턴으로 꼽혔지만, 실제로 남아 있는 코드베이스가 적지 않다.

### 약한 참조

`java.lang.ref`의 참조 API와 `WeakHashMap`에 값 객체를 넣으면 `IdentityException`이 난다. `Long`이나 `LocalDate`를 키로 쓰는 `WeakHashMap` 캐시가 있다면 확인 대상이다.

### 리플렉션

값 객체는 진짜 불변이다. 필드에 `setAccessible`을 호출하면 final 필드 변경을 허용한 상태에서도 `IllegalAccessException`이 난다. 직렬화 라이브러리나 테스트용 리플렉션 유틸리티가 이런 식으로 필드를 건드리는 경우가 있다.

## 3. record 생성자도 바뀐다

이건 컴파일할 때 프리뷰를 켠 경우에만 해당한다. 프리뷰 없이 컴파일한 생성자는 프리뷰를 켜고 실행해도 컴파일된 그대로 돈다.

프리뷰를 켜고 컴파일하면 record 생성자 코드는 early construction 단계에서 실행된다. 이 단계에서 `this`로 할 수 있는 일은 필드 대입뿐이라, 생성자 안에서 인스턴스 메서드를 부르면 컴파일 오류가 난다. 글이 제시하는 고치는 방법은 세 가지다.

1. 문제의 문장을 지운다.
2. static 문맥처럼 `this`에 의존하지 않게 바꾼다.
3. 필드를 모두 대입하고 `super()`나 `this(...)`로 early construction을 끝낸 뒤 실행한다.

compact 생성자에는 원래 이런 문장이 없어야 한다는 게 글의 입장이다. 필드가 기본값인 상태로 인스턴스가 노출되기 때문이다. 지울 수 없다면 일반 생성자 형태로 바꾸라고 한다.

## 4. 지금 해 볼 것

글은 가능하다면 CI에서 JDK 28로 프리뷰를 끈 상태와 켠 상태를 모두 빌드, 테스트하라고 권한다. 프리뷰를 켜는 표준 플래그는 `--enable-preview`다. 점검 대상을 추리면 이렇다.

- 래퍼 클래스, `Optional`, `java.time` 타입을 `==`로 비교하는 코드와 테스트
- 이 타입들을 락 객체로 쓰는 `synchronized` 블록
- 이 타입을 키로 쓰는 `WeakHashMap`이나 약한 참조 캐시
- 리플렉션으로 이 타입의 필드를 바꾸는 라이브러리
- 생성자 안에서 인스턴스 메서드를 호출하는 record

기대한 차이가 아닌 이상 동작을 발견하면 valhalla-dev 메일링 리스트로 보고해 달라는 요청도 붙어 있다.

## 참고 자료

- [Quality Outreach Heads-up - JDK 28: Value Classes (Inside.java)](https://inside.java/2026/10/27/quality-heads-up/)
- [JEP 401: Value Classes and Objects (OpenJDK)](https://openjdk.org/jeps/401)
