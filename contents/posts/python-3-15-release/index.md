---
title: "Python 3.15 정식 출시: lazy import와 UTF-8 기본값, 서버 코드에서 먼저 볼 것"
description: "10월 9일 나온 Python 3.15.0에서 백엔드 코드에 영향을 주는 변경을 공식 What's New 문서 기준으로 정리했다. lazy import, UTF-8 기본 인코딩, frozendict, Tachyon 프로파일러, 동작이 바뀌는 API를 다룬다."
date: 2026-10-12T09:05:00
update: 2026-10-12T09:05:00
tags:
  - Python
  - Performance
  - DevOps
---

Python 3.15.0이 10월 9일 정식으로 나왔다. 새 문법도 여럿 들어갔지만, 서버 코드를 올리는 입장에서 먼저 볼 건 두 가지다. 인코딩을 지정하지 않은 `open()`이 이제 시스템 로케일과 상관없이 UTF-8로 동작한다는 것, 그리고 `lazy import`로 시작 시간을 줄일 수 있게 됐다는 것이다. 앞의 것은 조용히 동작을 바꾸고, 뒤의 것은 손을 대야 효과가 난다.

> 3.15로 올릴 때 기존 서버 코드에서 깨질 만한 부분은 어디고, 새로 써 볼 만한 기능은 무엇인가?

> 이 글은 Python Insider의 3.15.0 출시 글과 공식 "What's New in Python 3.15" 문서를 읽고 정리했다. JIT는 여전히 실험 기능이라 성능 수치는 공식 발표 값만 옮겼다.

## 1. 한눈에 보는 변경

| 분류            | 변경                                   | 서버 코드 영향             |
| --------------- | -------------------------------------- | -------------------------- |
| 기본 동작       | UTF-8이 기본 인코딩 (PEP 686)          | 로케일 의존 코드 점검      |
| 문법            | `lazy import` (PEP 810)                | 시작 시간 단축             |
| 내장 타입       | `frozendict`, `sentinel` 추가          | `dict` 타입 검사 코드 점검 |
| 표준 라이브러리 | `profiling` 패키지, Tachyon 프로파일러 | 운영 중 프로세스 분석      |
| 빌드            | 프레임 포인터 기본 활성화 (PEP 831)    | 시스템 프로파일러와 궁합   |

출시 글에 따르면 실험 JIT는 x86-64 Linux에서 기본 인터프리터 대비 기하평균 7~8%, AArch64 macOS에서는 tail-calling 인터프리터 대비 11~12% 빨라졌다. 커밋 5,643개, 기여자 1,012명이 참여한 릴리스다.

## 2. UTF-8 기본값: 조용히 바뀌는 동작

지금까지 `open('data.csv')`처럼 인코딩을 안 적으면 시스템 로케일을 따랐다. 리눅스 서버는 대부분 이미 UTF-8이라 체감이 없었겠지만, 로케일이 `C`나 `POSIX`로 잡힌 컨테이너, Windows 서버, 오래된 배치 서버에서는 결과가 달라진다. 3.15부터는 로케일과 상관없이 UTF-8이다.

**문제가 되는 건 UTF-8이 아닌 파일을 인코딩 지정 없이 읽던 코드다.** 예를 들어 CP949로 저장된 레거시 CSV를 Windows에서 그냥 열던 스크립트는 3.15에서 `UnicodeDecodeError`가 날 수 있다.

```python
# 3.15 이전에는 로케일을 따랐고, 3.15부터는 UTF-8
with open("legacy.csv") as f:
    ...

# 어느 버전에서든 같은 결과를 원하면 명시한다
with open("legacy.csv", encoding="cp949") as f:
    ...
```

당장 예전 동작이 필요하면 `PYTHONUTF8=0` 환경 변수나 `-X utf8=0` 옵션으로 되돌린다. 다만 문서도 장기적으로는 `encoding`을 직접 적으라고 권한다.

## 3. lazy import로 시작 시간 줄이기

새 soft keyword `lazy`를 붙이면 모듈을 실제로 쓰는 순간까지 로딩을 미룬다. 공식 문서 예시는 이렇다.

```python
lazy import json
lazy from pathlib import Path

print("Starting up...")  # json, pathlib은 아직 로딩되지 않음

data = json.loads('{"key": "value"}')  # 여기서 json 로딩
p = Path(".")  # 여기서 pathlib 로딩
```

서버리스 함수의 콜드 스타트, CLI 도구, 무거운 라이브러리를 잔뜩 import하지만 요청마다 일부만 쓰는 워커에서 효과가 클 것 같다. 코드를 하나하나 고치지 않고 필터로 범위를 정하는 방법도 있다.

```python
import sys

def myapp_filter(importing, imported, fromlist):
    return imported.startswith("myapp.")

sys.set_lazy_imports_filter(myapp_filter)
sys.set_lazy_imports("all")
```

제약도 분명하다. `lazy`는 모듈 최상단에서만 쓸 수 있고, 함수나 클래스 본문, `try`/`except` 블록 안에서는 `SyntaxError`다. 개인적으로 가장 신경 쓰인 건 **모듈 로딩 실패가 import 시점이 아니라 처음 쓰는 시점에 터진다**는 점이다. 서버가 뜰 때는 멀쩡하다가 특정 API가 처음 호출될 때 `ImportError`가 나는 식이 된다. 배포 직후 헬스 체크만으로는 못 잡을 수 있으니, 도입한다면 스모크 테스트가 실제로 그 경로를 타는지 봐야 한다.

## 4. frozendict와 타입 검사 코드

`frozendict`가 내장 타입으로 들어왔다. 변경할 수 없고 해시가 되니 캐시 키나 설정값을 담기 좋다. `pickle`, `json`, `pprint` 등도 이 타입을 받는다.

여기서 걸리는 게 하나 있다. `frozendict`는 `dict`의 하위 클래스가 아니다. 그래서 입력 검증에서 `isinstance(value, dict)`로 분기하던 코드는 `frozendict`를 받으면 다른 경로로 빠진다. 문서는 `(dict, frozendict)`나 `collections.abc.Mapping`으로 검사하라고 안내한다.

```python
from collections.abc import Mapping

def normalize(value):
    if isinstance(value, Mapping):  # dict, frozendict 모두 통과
        return dict(value)
    raise TypeError("mapping required")
```

컴프리헨션 안에서 언패킹도 된다. `[*L for L in lists]`가 리스트를 평탄화하고, `{**d for d in dicts}`가 딕셔너리를 합친다. 쓰기 편하지만 팀 내 Python 버전이 섞여 있다면 아직은 쓰지 않는 게 낫다.

## 5. Tachyon 프로파일러와 프레임 포인터

새 `profiling` 패키지 아래 `profiling.tracing`(기존 `cProfile`)과 `profiling.sampling`이 들어갔다. 후자가 Tachyon이라는 샘플링 프로파일러다. 코드를 고치지 않고 실행 중인 프로세스에 PID로 붙을 수 있고, 최대 1,000,000Hz까지 샘플링한다.

| 항목 | 지원 값                                                        |
| ---- | -------------------------------------------------------------- |
| 대상 | `attach`(PID), `run`, `run -m`, `dump`                         |
| 모드 | `wall`(기본), `cpu`, `gil`, `exception`                        |
| 출력 | `--flamegraph`, `--pstats`, `--collapsed`, `--gecko`, `--live` |

운영 중인 API 서버가 갑자기 느려졌을 때 py-spy 같은 외부 도구 없이 표준 라이브러리만으로 플레임 그래프를 뽑을 수 있게 된 셈이다. `dump --async-aware`로 asyncio 태스크 스택을 한 번에 찍는 기능도 있다. 정확한 명령 형식은 `profiling.sampling` 문서를 보고 쓰는 게 좋겠다. 참고로 `profile` 모듈은 deprecated가 됐고 3.17에서 제거된다.

프레임 포인터가 기본으로 켜진 것도 같은 맥락이다. `perf` 같은 시스템 프로파일러로 Python 프로세스를 볼 때 스택이 제대로 이어진다.

## 6. 올리기 전 점검할 것

What's New 문서의 동작 변경 항목 중 서버 코드에서 걸릴 만한 것만 골랐다.

- 인코딩 없이 파일을 여는 코드, 특히 Windows나 `C` 로케일 컨테이너에서 도는 배치
- `isinstance(x, dict)` 검사가 `frozendict`를 받을 가능성
- `importlib.metadata.metadata()`가 메타데이터가 없을 때 빈 객체 대신 `MetadataNotFound`를 던짐
- `__cached__` 속성은 더 이상 설정되지 않으니 `__spec__.cached`로 교체
- `argparse`의 `suggest_on_error`가 기본 `True`로 바뀌어 CLI 오류 메시지가 달라짐
- 3.14.0~3.14.4에 들어갔던 incremental GC가 메모리 문제로 3.13 방식으로 되돌아감
- C 확장을 직접 빌드한다면 free-threaded 빌드용 `abi3t` 대응 여부

GC가 되돌아간 건 3.14 초기 버전에서 메모리 사용량이 늘었던 서비스라면 오히려 반가운 소식이다. 3.14 마이너를 올리며 메모리 그래프가 달라졌던 팀이라면 3.15에서 다시 확인해 볼 만하다.

## 참고 자료

- [Python 3.15.0 (final) is here! (Python Insider)](https://blog.python.org/2026/10/python-3150-final-is-here)
- [What's New in Python 3.15 (Python 공식 문서)](https://docs.python.org/3.15/whatsnew/3.15.html)
- [PEP 810: Explicit lazy imports](https://peps.python.org/pep-0810/)
- [PEP 686: Make UTF-8 mode default](https://peps.python.org/pep-0686/)
