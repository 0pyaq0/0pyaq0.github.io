---
title: "Go 1.27 encoding/json/v2 정식 도입: import만 바꾸면 달라지는 동작들"
description: "Go 1.27에서 encoding/json/v2와 jsontext가 정식 패키지가 됐다. v1과 다른 기본 동작, v1 호환 옵션으로 단계적으로 옮기는 방법을 공식 블로그와 마이그레이션 가이드 기준으로 정리했다."
date: 2026-11-05T09:40:00
update: 2026-11-05T09:40:00
tags:
  - Go
  - JSON
---

Go 팀이 11월 4일 블로그에서 **`encoding/json/v2`와 `encoding/json/jsontext`가 Go 1.27에서 안정화되어 정식으로 쓸 수 있게 됐다**고 발표했다. Go 1.25의 실험 기능이 정식이 된 것이다. import 경로만 바꿔도 컴파일은 된다. 문제는 nil 슬라이스, 대소문자 매칭, 중복 키 처리 같은 기본 동작이 바뀌어서 API 응답 모양이 조용히 달라질 수 있다.

> v2로 옮기면 무엇이 달라지고, 운영 중인 서비스는 어떤 순서로 옮기는 게 안전한가?

> 이 글은 Go 공식 블로그의 "A new Go API for JSON", `encoding/json/v2` 패키지 문서, JSON v2 마이그레이션 가이드를 읽고 정리했다.

## 1. 무엇이 들어왔나

패키지가 두 층으로 나뉜다.

| 패키지                   | 역할                   | 주요 타입·함수                         |
| ------------------------ | ---------------------- | -------------------------------------- |
| `encoding/json/jsontext` | JSON 문법 수준 처리    | `Encoder`, `Decoder`, `Value`, `Token` |
| `encoding/json/v2`       | Go 값과 JSON 사이 변환 | `Marshal`, `Unmarshal`, `Options`      |
| `encoding/json`          | 기존 v1                | 내부가 v2 위에서 동작                  |

v2의 패키지 이름도 `json`이라서 `json.Marshal(v)` 같은 호출은 그대로 컴파일된다. 대신 `Marshal`, `Unmarshal`이 가변 인자로 옵션을 받는다. 스트림을 다루는 `MarshalWrite`, `UnmarshalRead`와 `jsontext.Encoder`, `Decoder`를 직접 쓰는 `MarshalEncode`, `UnmarshalDecode`도 생겼다.

블로그에 따르면 이제 v1은 내부적으로 v2에 v1 호환 옵션 전체를 넘기는 방식으로 구현돼 있다. v1은 계속 지원되며 꼭 옮길 필요는 없다고 명시했다.

## 2. 기본 동작이 달라지는 지점

블로그가 직접 꼽은 차이는 이렇다.

| 항목             | v1 기본          | v2 기본                |
| ---------------- | ---------------- | ---------------------- |
| nil 슬라이스·맵  | `null`           | `[]`, `{}`             |
| 구조체 필드 매칭 | 대소문자 무시    | 대소문자 구분          |
| 중복 키          | 허용             | 오류                   |
| 잘못된 UTF-8     | 대체 문자로 바꿈 | 오류                   |
| `time.Duration`  | 직렬화됨         | 오류, 표현을 직접 지정 |

개인적으로는 앞의 두 줄이 가장 걸렸다. nil 슬라이스가 `null` 대신 `[]`로 나가면 프론트엔드나 다른 서비스가 `null` 체크로 분기하던 코드가 다르게 동작한다. 마이그레이션 가이드의 예시가 딱 이 경우다.

```text
v1: [{"Name":"Oliver","Nicknames":["Ollie","Olliepop"]},{"Name":"Remi","Nicknames":null}]
v2: [{"Name":"Oliver","Nicknames":["Ollie","Olliepop"]},{"Name":"Remi","Nicknames":[]}]
```

대소문자 구분도 같다. 외부 API 응답의 키 표기가 구조체 태그와 대소문자까지 맞지 않으면 v2에서는 그 필드가 비어 버린다.

`omitempty`의 의미도 바뀌었다. v2에서는 인코딩 결과가 `null`, `""`, `[]`, `{}` 중 하나일 때 필드를 뺀다. Go 값 기준으로 0인지를 보려면 `omitzero`를 쓴다. 패키지 문서 설명으로는 nil 슬라이스나 맵만 `omitzero`로 빠지고, 비어 있는 슬라이스나 맵은 nil 여부와 상관없이 `omitempty`로 빠진다.

구조체 정의에 문제가 있을 때의 반응도 다르다. v1은 잘못된 필드 태그가 있어도 런타임에 오류를 내지 않았지만, v2는 JSON 직렬화에 맞지 않는 타입이면 런타임 오류를 낸다.

## 3. v1 동작을 유지하면서 옮기기

블로그는 대부분의 동작 차이를 구조체 태그나 호출 옵션으로 v1 쪽으로 되돌릴 수 있다고 했다. 마이그레이션 가이드가 권하는 방법은 `encoding/json`의 `DefaultOptionsV1()`을 넘겨 v1과 똑같이 동작하게 한 뒤, v2 옵션을 하나씩 켜는 것이다. 뒤에 오는 옵션이 앞의 옵션을 덮어쓴다.

```go
import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
)

// 1단계: 패키지만 v2로, 동작은 v1 그대로
b, err := json.Marshal(pets, jsonv1.DefaultOptionsV1())

// 2단계: nil 슬라이스만 v2 방식([])으로
b, err = json.Marshal(pets, jsonv1.DefaultOptionsV1(), json.FormatNilSliceAsNull(false))
```

필드 단위로 조절할 때는 태그를 쓴다. `case:ignore`는 대소문자와 대시, 밑줄까지 무시하고 매칭한다. 필드에 지정한 옵션이 호출 옵션보다 우선한다.

```go
type User struct {
	FirstName string   `json:"firstName,case:ignore"`
	Tags      []string `json:"tags,omitzero"`
}
```

쓸 만한 v2 옵션 이름도 정리해 둔다. `RejectUnknownMembers`는 구조체에 없는 키가 오면 오류를 낸다. `MatchCaseInsensitiveNames`는 대소문자 무시 매칭을 호출 단위로 켠다. 중복 키와 잘못된 UTF-8을 다시 허용하려면 `jsontext.AllowDuplicateNames`, `jsontext.AllowInvalidUTF8`을 넘긴다.

가이드는 v1과 v2를 둘 다 호출해 차이를 보고하는 `jsonsplit` 패키지도 소개하는데, 마샬 비용이 대략 두 배가 된다.

## 4. 성능

블로그에 적힌 수치는 이렇다. `Marshal`은 v1과 거의 같다. 조금 빠를 때도, 조금 느릴 때도 있다. `Unmarshal`은 훨씬 빠르고 벤치마크에서 최대 10배 개선을 보였다고 한다.

더 큰 이득을 보려면 직접 구현한 `MarshalJSON`, `UnmarshalJSON`에 `MarshalJSONTo`, `UnmarshalJSONFrom`도 구현하라고 권한다. 바이트 슬라이스를 주고받는 대신 `jsontext.Encoder`, `Decoder`로 스트리밍하는 인터페이스다. 블로그는 Kubernetes에서 `UnmarshalJSONFrom`으로 바꿨더니 성능이 자릿수 단위로 좋아졌다는 사례를 들었다. Go 1.28에서 추가 최적화가 나올 예정이라고도 한다.

### 점검 목록

- 프로젝트를 Go 1.27로 올릴지, v2를 쓸지 따로 결정한다
- nil 슬라이스를 `null`로 받는 클라이언트가 있는지 확인한다
- 외부 API 응답 키의 대소문자가 구조체 태그와 정확히 맞는지 본다
- 처음엔 `DefaultOptionsV1()`으로 옮기고 옵션을 하나씩 켠다
- `time.Duration` 필드가 JSON에 들어가는지 검색한다
- 언마샬이 많은 경로부터 `UnmarshalJSONFrom` 구현을 검토한다

## 참고 자료

- [A new Go API for JSON](https://go.dev/blog/jsonv2)
- [encoding/json/v2 package documentation](https://pkg.go.dev/encoding/json/v2)
- [JSON v2 migration guide](https://go.dev/doc/jsonv2-migration)
