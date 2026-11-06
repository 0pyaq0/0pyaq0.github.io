---
title: "Django 11월 보안 릴리스: 캐시 키 변경과 GIS 입력 거부까지, 올리기 전에 볼 동작 변화"
description: "Django 6.1.3, 6.0.10, 5.2.19가 CVE 여섯 건을 고쳤다. 대부분 낮음 등급이지만 캐시 키 계산 방식과 GeoJSON, SpatialReference 입력 처리가 바뀐다. 공식 공지와 릴리스 노트 기준으로 정리했다."
date: 2026-11-06T09:40:00
update: 2026-11-06T09:40:00
tags:
  - Python
  - Django
  - Security
---

11월 3일 Django가 **6.1.3, 6.0.10, 5.2.19 보안 릴리스**를 냈다. CVE는 여섯 건이고 등급은 보통 하나, 낮음 다섯이다. 등급은 낮아도 몇 개는 동작을 바꾼다. 업그레이드 직후 캐시 적중률이 잠깐 떨어지고, GIS 기능을 쓰는 곳에서는 전에 받아들이던 입력이 거부된다.

> 이번 패치를 올리면 무엇이 달라지고, 어떤 서비스가 특히 서둘러야 하는가?

> 이 글은 Django 공식 블로그의 보안 릴리스 공지와 6.1.3 릴리스 노트를 읽고 정리했다. 6.0.10, 5.2.19의 버그 수정 목록은 따로 확인하지 않았다.

## 1. 여섯 건 한눈에 보기

여섯 건 모두 main, 6.1, 6.0, 5.2 브랜치에 영향이 있다.

| CVE               | 대상                            | 등급 | 동작 변화          |
| ----------------- | ------------------------------- | ---- | ------------------ |
| `CVE-2026-108147` | `MultiPartParser` base64 업로드 | 낮음 | 없음               |
| `CVE-2026-111211` | GIS `GeometryField` 로그        | 낮음 | 로그 값 이스케이프 |
| `CVE-2026-111362` | GeoJSON `crs` 처리              | 보통 | 외부 CRS 참조 거부 |
| `CVE-2026-113593` | 캐시 미들웨어 `Vary` 처리       | 낮음 | 캐시 키 계산 변경  |
| `CVE-2026-113733` | admin 비밀번호 해시 노출        | 낮음 | 없음               |
| `CVE-2026-114582` | `SpatialReference` 문자열 입력  | 낮음 | 경로·URL 입력 거부 |

GIS 관련이 세 건이다. `django.contrib.gis`를 쓰지 않는 서비스라면 실질적으로 볼 것은 업로드, 캐시, admin 세 건이 된다.

## 2. 모든 서비스가 볼 세 건

### base64 업로드 메모리 문제

`Content-Transfer-Encoding: base64`로 온 multipart 업로드가 `FILE_UPLOAD_MAX_MEMORY_SIZE` 설정과 상관없이 업로드 핸들러에 닿기 전에 통째로 메모리에 쌓였다. 수정으로 바뀌는 설정은 없다.

### 비어 있는 헤더와 없는 헤더

개인적으로는 이 건이 가장 걸렸다. `UpdateCacheMiddleware`나 `cache_page()`를 쓸 때, `Vary`에 지정된 헤더를 아예 보내지 않은 요청과 빈 값으로 보낸 요청이 같은 캐시 키를 만들었다. 그래서 한쪽 응답이 다른 쪽에 나갈 수 있었다. `Vary: Authorization`이나 `Vary: Cookie`로 사용자별 응답을 나누던 곳이라면 의미가 크다.

수정 후에는 RFC 9111 4.1절에 맞춰 헤더가 없는 경우와 빈 경우를 다른 키로 계산한다. 공지는 부작용도 같이 적었다. **헤더를 생략한 요청으로 이미 캐시된 응답은 더 이상 매칭되지 않고, 다음 요청에서 다시 캐시된다.** 업그레이드 직후 캐시 미스가 늘어나는 건 정상이라는 뜻이다.

### admin 보기 전용 권한

admin에서 변경 권한 없이 보기 권한만 가진 사용자가 비밀번호 해시 전체를 볼 수 있었다. 조건은 해당 모델이 `AUTH_USER_MODEL`이 아니거나, `AUTH_USER_MODEL`이 `password` 필드를 다중 테이블 상속으로 부모에게서 물려받은 경우다. 커스텀 사용자 모델을 따로 두고 admin에 등록한 프로젝트가 대상이다.

## 3. GIS를 쓴다면 서둘러야 할 이유

유일한 보통 등급이 여기 있다. GeoJSON 지오메트리의 `crs` 멤버에 URL을 넣으면 GDAL이 그걸 해석한다. 사용자 입력으로 만든 지오메트리가 Django 프로세스 권한으로 외부 요청을 보내거나 파일을 읽을 수 있었다. SSRF(Server-Side Request Forgery)다.

수정 후에는 공간 필드 조회, `GeometryField` 폼 필드, `GEOSGeometry`가 외부 리소스를 가리키는 CRS 참조를 거부한다. 신뢰된 데이터를 적재할 때 쓰는 `DataSource`, `LayerMapping`은 계속 받아 준다.

`SpatialReference` 문자열 입력도 같은 종류의 문제였다. 영향받는 곳이 넓다.

- `SpatialReference` 생성
- `GEOSGeometry.transform()`, `OGRGeometry.transform()`, `GDALRaster.transform()`
- `OGRGeometry`의 `srs` 설정, `GDALRaster`의 `srs`, `srid` 설정

수정 내용은 GDAL 3.9 이상에서 문자열 파싱 시 네트워크와 파일 접근을 끄는 것이다. 그 결과 파일 경로와 URL은 더 이상 `SpatialReference` 입력으로 받지 않는다. `DICT:` 접두사(그리고 `ESRI::`가 붙은 것)는 GDAL 버전과 상관없이 거부된다. 완전한 보호에는 GDAL 3.9 이상이 필요해서, 그보다 낮으면 새 시스템 체크 `gis.W001`이 경고를 낸다. 공지는 신뢰할 수 없는 입력에는 정수 SRID를 쓰라고 권한다.

```bash
# 업그레이드 후 GDAL 버전 경고가 뜨는지 확인
python manage.py check

# 설치된 GDAL 버전 직접 확인
gdal-config --version
```

GIS 로그 건은 잘못된 지오메트리 입력이 그대로 로그에 찍히면서 줄바꿈이나 ANSI 이스케이프 같은 제어 문자가 섞여 들어가던 문제다. 이제 로그에 남길 때 이스케이프한다.

## 4. 같이 들어온 버그 수정

6.1.3에는 Python 3.15 호환성 추가와 `oracledb` 26.0.0 이상 지원, YAML 직렬화 `sort_keys` 회귀 수정 같은 버그 수정도 들어 있다. 6.1에서 Python 3.15로 올릴 계획이라면 이 버전이 기준점이다.

### 점검 목록

- 사용 중인 Django를 6.1.3, 6.0.10, 5.2.19 중 해당 버전으로 올린다
- `cache_page`, `UpdateCacheMiddleware` 사용처와 `Vary` 헤더를 확인한다
- 배포 직후 캐시 미스 증가를 예상하고 시간대를 고른다
- 커스텀 사용자 모델이 admin에 보기 권한으로 노출되는지 본다
- GIS를 쓴다면 GDAL 3.9 이상인지, `gis.W001` 경고가 뜨는지 확인한다
- 사용자 입력을 `SpatialReference`에 넘기는 코드를 정수 SRID로 바꾼다

## 참고 자료

- [Django security releases issued: 6.1.3, 6.0.10, and 5.2.19](https://www.djangoproject.com/weblog/2026/nov/03/security-releases/)
- [Django 6.1.3 release notes](https://docs.djangoproject.com/en/6.1/releases/6.1.3/)
