---
title: "eMudhra 중간 CA 키 노출: 브라우저 밖 TLS 클라이언트가 먼저 위험하다"
description: "10월 17일 보고된 eMudhra 중간 CA 8개의 개인키 노출 사건을 정리했다. 브라우저는 바로 막혔지만 pip, curl 같은 비브라우저 클라이언트는 업데이트가 필요하다. Python 쪽 대응과 점검 순서를 공식 공지 기준으로 적었다."
date: 2026-10-24T09:40:00
update: 2026-10-24T09:40:00
tags:
  - Python
  - Security
  - DevOps
---

eMudhra의 중간 CA 인증서 8개의 개인키가 사실상 공개된 상태였다는 사실이 10월 17일 보고됐다. 이 키가 있으면 아무 웹사이트나 사칭하는 인증서를 만들 수 있다. 브라우저는 당일부터 막았지만, CT(Certificate Transparency)를 확인하지 않는 curl, pip 같은 클라이언트는 신뢰 저장소를 업데이트해야 막힌다. 서버에서 외부로 HTTPS를 호출하는 코드는 대부분 이쪽이다. Python은 10월 21일 3.15.1, 3.14.9, 3.13.17을 긴급 보안 릴리스로 냈고, 지난번 Node.js 보안 릴리스의 루트 인증서 갱신도 같은 사건 때문이었다.

> 브라우저가 이미 막았다면 서버 쪽은 무엇을 업데이트해야 하나?

> 이 글은 사건 공개 페이지, Python Insider 릴리스 공지, Python Discourse 안내 글을 확인해 정리했다. 공개 페이지와 Discourse 글은 계속 갱신되고 있어서 세부 버전은 바뀔 수 있다.

## 1. 무슨 일이 있었나

키를 도난당한 게 아니다. CA가 키를 잘못 생성했고, 그래서 공개된 인증서만으로 개인키를 복원할 수 있었다. Python Discourse에서 Christian Heimes는 타원곡선 키의 개인값이 `d=4`인 경우가 있었고, 8개 CA 모두 `d < 256`이었다고 설명했다. 사실상 키가 없는 것과 같다.

| 날짜       | 일                                         |
| ---------- | ------------------------------------------ |
| 2025년 4월 | 문제의 중간 CA 생성. 이때부터 키 복원 가능 |
| 2026-10-17 | 보고. Firefox, Chrome 당일 차단            |
| 2026-10-19 | 하위 신뢰 저장소에 공개                    |
| 2026-10-20 | Microsoft 플랫폼 차단, 사건 페이지 공개    |
| 2026-10-22 | Apple 차단                                 |

공개 페이지에 따르면 CT를 강제하는 브라우저(Firefox, Chrome, Edge, Safari)는 공격받지 않았을 것으로 본다. 해당 기간에 이 중간 CA들의 CT 로그 기록이 없기 때문이다. 반면 curl처럼 CT를 확인하지 않는 클라이언트가 실제로 공격받았는지는 모른다고 적혀 있다.

## 2. 왜 서버 쪽이 더 걸리나

브라우저는 OneCRL, CRLite, CRLSets 같은 폐기 정보를 받아서 바로 막았다. **폐기 정보를 쓰지 않는 클라이언트는 소프트웨어 업데이트 말고는 막을 방법이 없다.** 사건 페이지가 Node.js, Python, Go, Java 같은 런타임과 curl, certifi, NSS 같은 CA 번들을 패치 목록에 올려 둔 이유다.

Python 쪽에서 개인적으로 가장 걸린 부분은 pip다. Discourse 안내에 따르면 pip는 자체 번들한 certifi를 시스템 신뢰 저장소와 **함께** 읽고, 이걸 끌 공식 방법이 없다. OS에서 해당 인증서를 불신 처리해도 pip `26.2.2` 미만은 계속 이 중간 CA를 신뢰한다는 뜻이다. python.org와 pypi.org에 대한 중간자 공격 위험도 언급돼 있다.

## 3. Python 쪽 수정 버전

Discourse 글에 정리된 최소 안전 버전은 이렇다.

| 패키지   | 최소 버전    |
| -------- | ------------ |
| certifi  | `2026.10.19` |
| pip      | `26.2.2`     |
| uv       | `0.13.4`     |
| sigstore | `4.5.1`      |
| conda    | `26.9.4`     |

새 Python 릴리스는 번들된 pip를 `26.2.2`로 올린 것 말고는 동작 변화가 없다. 평소엔 하위 호환 때문에 보안 릴리스에서 pip를 잘 올리지 않는데 이번엔 예외로 했다고 한다. 3.13은 보안 수정만 받는 단계에 막 들어갔는데도 설치 파일을 새로 냈다.

기존 가상환경은 새 Python을 깔아도 그대로다. 각 환경에서 pip와 certifi를 따로 올려야 한다. 공지는 pip 휠 URL에 SHA-256 해시를 붙여 설치하는 명령을 안내한다. 업데이트 경로 자체가 위험할 수 있으니 해시로 검증하라는 취지다. uv는 시스템 인증서를 쓰게 해서 자기 업데이트를 할 수 있다.

```bash
UV_SYSTEM_CERTS=true uv self update
```

## 4. 점검 순서

Discourse 글과 사건 페이지에서 서버 운영 관점으로 추린 항목이다.

1. 컨테이너 이미지를 레이어 캐시 없이 다시 빌드해 최신 시스템 인증서를 받는다.
2. 공식 Docker `python` 이미지는 10월 21일 기준으로 아직 pip `26.2.1`이었다. 이미지가 갱신되기 전이라면 `PIP_CERT`를 시스템 CA 번들로 지정하는 우회가 안내돼 있다.
3. 의존성 쿨다운(새 버전 사용 유예)을 쓰고 있다면 그 기간 동안은 패치가 안 들어온다. certifi, pip는 예외로 풀어 준다.
4. Debian의 python-pip는 시스템 CA 저장소를 쓰도록 패치돼 있어서, 10월 20일 나온 `ca-certificates` 보안 업데이트로 해결된다.
5. Java는 인증서 저장소가 시스템 저장소와 어긋날 수 있다고 사건 페이지가 따로 경고한다. JVM을 쓰는 서비스는 런타임 자체 저장소도 확인한다.
6. 사건 페이지의 테스트 호스트에 curl로 접속해 본다. 인증서 오류가 나면 막힌 것이고, 접속이 되면 아직 신뢰하고 있다는 뜻이다.

CPython `ssl` 모듈에 노출된 키를 SPKI 해시로 거부하는 차단 목록을 넣는 작업도 진행 중이다. Go도 비슷한 완화책을 넣었다고 한다. 다만 이건 방어를 한 겹 더하는 것이지 업데이트를 대신하지는 않는다.

## 참고 자료

- [eMudhra Intermediate CA Compromise (사건 공개 페이지)](https://emudhra.we-have-a-problem.com/)
- [Python 3.15.1, 3.14.9 and 3.13.17 are out (Python Insider)](https://blog.python.org/2026/10/python-3151-3149-31317)
- [Information for Python users regarding eMudhra/emSign CA certificate security incident (Python Discourse)](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576)
