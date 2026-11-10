---
title: "Azure Front Door 하이브리드 양자 내성 키 교환 GA: 기본값이 이미 바뀌었다"
description: "Azure Front Door가 TLS 키 교환 정책을 정식 지원하면서 기본 정책에 ML-KEM 하이브리드 그룹이 들어갔다. 세 가지 정책의 차이와 커스텀 정책을 쓸 때 조심할 점을 공식 문서 기준으로 정리했다."
date: 2026-11-10T09:40:00
update: 2026-11-10T09:40:00
tags:
  - Azure
  - Security
---

Azure Front Door가 11월 5일(UTC) TLS 키 교환 정책을 정식 출시(GA)했다. 도메인마다 TLS 핸드셰이크에서 어떤 키 교환 그룹을 허용할지 고를 수 있게 됐고, 그 목록에 ML-KEM을 섞은 하이브리드 양자 내성(post-quantum) 그룹이 들어갔다. 눈여겨볼 부분은 기본값이다. 기존 프로필도 쓰는 `Standard` 정책에 하이브리드 그룹이 이미 들어 있다.

대부분은 할 일이 없다. 다만 그룹을 직접 고르는 `Custom` 정책은 잘못 쓰면 TLS 1.2 클라이언트를 통째로 끊는다.

> 기본값으로 둘지, 키 교환 그룹을 직접 좁힐지 무엇을 보고 정해야 할까?

> 이 글은 Microsoft Learn의 Front Door TLS 키 교환 정책 문서, Azure 업데이트 공지, Microsoft의 PQC 기술 블로그 글을 확인해 정리했다.

## 1. 무엇이 추가됐나

기존 TLS 정책(`TLSv1.2_2023` 등)은 최소 TLS 버전과 암호 스위트(cipher suite)를 정한다. 키 교환 정책은 이것과도, 인증서 설정과도 별개다.

설정은 커스텀 도메인 단위로 `Standard`, `Enhanced`, `Custom` 중 하나를 고른다. 대상은 Front Door Standard와 Premium이고, classic은 문서에 없다.

정책은 **클라이언트와 Front Door 사이 연결**에만 걸린다. 오리진 쪽 연결은 이 정책과 무관하고, 블로그는 그 구간 확장을 다음 단계로만 언급했다.

## 2. 지원 그룹과 세 가지 정책

지원 그룹은 일곱 가지이고 하이브리드는 TLS 1.3 전용이다.

| 그룹 이름            | 구성                | TLS 버전 | 분류       |
| -------------------- | ------------------- | -------- | ---------- |
| `prime256v1`         | P-256               | 1.2, 1.3 | 고전       |
| `secp384r1`          | P-384               | 1.2, 1.3 | 고전       |
| `secp521r1`          | P-521               | 1.2, 1.3 | 고전       |
| `X25519`             | X25519              | 1.2, 1.3 | 고전       |
| `SecP256r1MLKEM768`  | P-256 + ML-KEM-768  | 1.3      | 하이브리드 |
| `X25519MLKEM768`     | X25519 + ML-KEM-768 | 1.3      | 하이브리드 |
| `SecP384r1MLKEM1024` | P-384 + ML-KEM-1024 | 1.3      | 하이브리드 |

하이브리드는 고전 타원곡선과 ML-KEM 결과를 섞는다. 지금 저장된 트래픽을 나중에 양자 컴퓨터로 푸는 공격에 대비하는 장치다.

정책별 구성은 이렇다.

| 정책       | 포함 그룹                                                                     | 특징                  |
| ---------- | ----------------------------------------------------------------------------- | --------------------- |
| `Standard` | `SecP256r1MLKEM768`, `X25519MLKEM768`, `prime256v1`, `secp384r1`, `secp521r1` | 새·기존 프로필 기본값 |
| `Enhanced` | `SecP256r1MLKEM768`, `prime256v1`, `secp384r1`, `secp521r1`                   | X25519 계열 제외      |
| `Custom`   | 위 일곱 개 중 직접 선택                                                       | 호환성은 사용자 책임  |

`Standard`에 순수 `X25519`가 없다는 점이 의외였다. 블로그에 따르면 하이브리드 그룹을 먼저 고르고 없으면 고전 그룹으로 내려간다. 정확한 우선순위는 문서에 없다.

## 3. 기존 프로필은 어떻게 되나

Learn 문서는 기존 프로필도 `Standard`를 쓰고 마이그레이션은 필요 없다고 적었다. 기본 Front Door 도메인은 항상 `Standard`이고 바꿀 수 없다. 블로그는 하이브리드 PQC가 기본으로 켜져 있다고 했다.

그래서 기존 프로필도 이미 하이브리드로 협상한다고 읽었다. 다만 두 문서를 엮은 해석이고, 언제부터 바뀌었는지는 나오지 않는다.

블로그는 합성 테스트에서 ML-KEM-768 계열의 CPU 오버헤드가 1% 미만이었다고 밝혔다. 서버 쪽 수치이고 클라이언트 지연 수치는 없다.

## 4. Custom 정책을 쓸 때 막히는 지점

문서의 경고는 한 문장으로 모인다. 클라이언트가 정책 안의 그룹을 하나도 지원하지 않으면 핸드셰이크가 실패한다.

### TLS 1.2를 허용하는 도메인

TLS 1.2 연결은 정책 안의 고전 그룹으로만 협상된다. TLS 1.2를 허용하면서 하이브리드 그룹만 넣으면 TLS 1.2 클라이언트는 전부 끊긴다. 두 정책이 따로 설정돼서 놓치기 쉽다.

### 오래된 클라이언트와 중간 장비

하이브리드는 핸드셰이크 메시지가 커서 문서는 지연과 네트워크 장비 호환성을 시험하라고 권한다. 클라이언트별 지원표는 없으니 실제 클라이언트로 확인해야 한다.

`Enhanced`는 X25519 계열이 빠지니 X25519만 아는 클라이언트는 따져 봐야 한다.

## 5. 협상된 그룹 확인하기

문서에 확인 명령이 없어 OpenSSL(하이브리드 그룹은 3.5부터)로 보는 방법을 적어 둔다.

```bash
openssl version

# 하이브리드 그룹만 제시해 보고 핸드셰이크가 되는지 본다
openssl s_client -connect www.example.com:443 -servername www.example.com \
  -tls1_3 -groups X25519MLKEM768 </dev/null 2>&1 | grep -iE 'group|Protocol'

# TLS 1.2 클라이언트가 고전 그룹으로 붙는지 본다
openssl s_client -connect www.example.com:443 -servername www.example.com \
  -tls1_2 -groups prime256v1 </dev/null 2>&1 | grep -iE 'Protocol|Cipher'
```

첫 명령은 `Standard`면 성공하고 `Enhanced`면 실패해야 정상이다.

### 점검 목록

- 커스텀 도메인별 키 교환 정책이 `Standard`인지 먼저 확인한다
- `Custom`을 쓰고 TLS 1.2를 허용한다면 고전 그룹이 하나 이상 들어 있는지 본다
- 사내망, 모바일 앱 같은 실제 클라이언트로 접속을 확인한다

## 참고 자료

- [TLS Key Exchange Policy - Azure Front Door (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/frontdoor/tls-key-exchange-policy)
- [Configure an Azure Front Door TLS policy (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/frontdoor/tls-policy)
- [Azure Front Door now Supports Post-Quantum Resilient Hybrid TLS 1.3 (Microsoft Tech Community)](https://techcommunity.microsoft.com/blog/post-quantum-crypto-tech-blog/azure-front-door-now-supports-post-quantum-resilient-hybrid-tls-1-3/4571081)
- [Generally Available: Azure Front Door TLS key exchange policy with post-quantum support (Azure Updates)](https://azure.microsoft.com/updates?id=577668)
