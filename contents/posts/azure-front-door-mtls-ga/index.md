---
title: "Azure Front Door mTLS GA: 클라이언트 인증서 검증을 엣지로 옮기기 전에 볼 것"
description: "Azure Front Door Premium에서 클라이언트 인증서 인증(mTLS)이 정식 지원됐다. 검증 모드 네 가지, 오리진으로 넘어가는 헤더, 캐시 제한까지 공식 문서 기준으로 정리했다."
date: 2026-11-17T09:40:00
update: 2026-11-17T09:40:00
tags:
  - Azure
  - Security
---

11월 12일 Azure Front Door Premium에서 상호 TLS(mTLS), 즉 클라이언트 인증서 인증이 정식 출시(GA)됐다. 지금까지 B2B API나 IoT 장비 연동처럼 클라이언트 인증서가 필요한 서비스는 Front Door 뒤의 오리진이 인증서를 직접 받아 검증해야 했다. 이제는 엣지에서 인증서를 검증하고 실패한 요청은 오리진까지 오지도 않게 막을 수 있다. 다만 켜는 순간 해당 라우트의 캐시를 못 쓰고, 기존 도메인에 켜면 다운타임이 생긴다는 제약이 있다.

> 클라이언트 인증서 검증을 Front Door로 옮기면 무엇을 얻고 무엇을 포기하나?

> 이 글은 Azure 업데이트 공지와 Microsoft Learn의 Front Door mTLS 문서를 확인해 정리했다. 가격과 규칙 엔진 연동은 문서에서 찾지 못해 다루지 않았다.

## 1. 검증 모드는 네 가지다

설정은 커스텀 도메인 단위다. 기본값은 꺼짐이고, 켜면 아래 중 하나를 고른다.

| 모드                | 인증서 없을 때  | 검증 주체  |
| ------------------- | --------------- | ---------- |
| 필수 + 검증         | 거부            | Front Door |
| 필수 + 미검증       | 거부            | 오리진     |
| 제시되면 검증       | 오리진으로 통과 | Front Door |
| 오리진으로 패스스루 | 오리진으로 통과 | 오리진     |

"필수 + 검증"이 mTLS를 켰을 때의 기본 모드다. Front Door가 검증을 끝낸 뒤 `X-Azure-ClientCertificate` 헤더에 인증서를 담아 오리진으로 넘긴다. "필수 + 미검증"은 인증서가 없는 요청만 걸러 내고 나머지 검증은 오리진에 맡긴다.

개인적으로는 "제시되면 검증" 모드가 쓸모 있어 보였다. 같은 도메인에서 인증서를 쓰는 파트너와 안 쓰는 일반 클라이언트가 섞여 있을 때, 인증서가 온 요청만 엣지에서 검증하고 나머지는 오리진의 다른 인증 방식으로 넘길 수 있다.

## 2. 무엇을 검증하나

신뢰할 CA는 Azure Key Vault를 통해 올린다. 루트 CA 인증서 하나에 중간 CA를 최대 3개까지 붙일 수 있고, PEM 형식에 25KB 미만이어야 한다. 루트만 올렸다면 클라이언트가 핸드셰이크에서 중간 인증서까지 보내야 한다. 교체를 위해 CA 인증서를 두 개까지 걸어 둘 수 있지만 자동 교체는 지원하지 않는다.

Front Door가 확인하는 항목은 이렇다.

- 유효 기간(not-before, not-after)
- 확장 키 용도(EKU)가 없거나 클라이언트 인증 OID를 포함하는지
- 신뢰한 발급자까지 끊기지 않은 체인인지(리프 포함 최대 5단계)
- 폐기 여부(기본으로 켜져 있고, AIA 확장의 **OCSP만 확인한다**)
- 선택 사항으로 허용 SAN/CN 목록

허용 목록은 SAN을 먼저 보고, 맞는 게 없거나 SAN이 비어 있으면 CN을 본다. 목록 자체에는 와일드카드를 쓸 수 없다. CRL 기반 폐기 확인은 문서에 언급이 없었다. 사내 PKI가 CRL만 운영한다면 이 부분부터 맞춰 봐야 한다.

문서에는 공개 CA가 클라이언트 인증용 EKU가 들어간 인증서 발급을 중단할 예정이라 사설 CA를 권한다는 경고도 있다. 새로 설계한다면 처음부터 사설 CA로 가는 편이 덜 번거롭다.

## 3. 켜기 전에 알아 둘 제약

### 캐시와 공존할 수 없다

**mTLS를 켜면 라우트나 규칙 엔진의 라우트 재정의에서 캐시를 켤 수 없다.** 같은 도메인에서 정적 파일을 캐시로 서빙하고 있었다면 경로를 나누거나 도메인을 분리해야 한다.

### 기존 도메인은 다운타임이 생긴다

문서는 새 엔드포인트와 도메인에서 mTLS를 켜라고 권한다. 이미 트래픽을 받는 도메인에서 켜거나 끄면 다운타임이 생긴다고 적혀 있다. 엔드포인트에서 "Enforce mutual TLS"를 켜면 기본 `azurefd.net` 도메인을 그 엔드포인트의 라우트에 붙일 수 없고, mTLS 상태가 다른 도메인끼리는 엔드포인트를 같이 쓸 수 없다.

### 오리진 우회 막기

엣지에서 검증해도 오리진이 인터넷에 열려 있으면 소용이 없다. 문서도 오리진이 Front Door 트래픽만 받도록 잠그라고 권한다. 그리고 클라이언트가 직접 보낸 `X-Azure-ClientCert*` 헤더는 Front Door가 오리진으로 넘기기 전에 지운다. 오리진이 이 헤더로 판단하려면 Front Door를 거친 요청만 들어온다는 전제가 있어야 한다.

## 4. 실패 원인 확인하기

요청에 `X-Azure-DebugInfo: 1` 헤더를 넣으면 응답의 `X-Azure-Externalerror`에 실패 이유가 담긴다.

```bash
curl -i https://api.example.com/health \
  --cert client.crt --key client.key \
  -H "X-Azure-DebugInfo: 1"
```

값은 `ClientCertExpired`, `ClientCertRevoked`, `ClientCertMissing`, `ClientCertRootCAUntrusted`, `ClientCertCNSANMismatch`, `ClientCertTooLongChain`, `ClientCertIncorrectPurpose`, `ClientCertInvalid` 중 하나다. 메트릭에서도 mTLS 요청 수와 실패 요청 수를 오류 유형, SNI 호스트명, TLS 프로토콜별로 볼 수 있다.

### 점검 목록

- Front Door가 Premium인지 확인한다(문서상 Premium 지원)
- 클라이언트 인증서 PKI가 OCSP를 제공하는지 본다
- mTLS를 켤 도메인의 라우트에서 캐시를 쓰는지 확인하고 경로를 나눈다
- 운영 중인 도메인이라면 새 도메인이나 새 엔드포인트로 전환하는 계획을 세운다
- 오리진이 Front Door 외 트래픽을 받지 않도록 잠근다

## 참고 자료

- [Generally Available: Azure Front Door mutual TLS authentication (Azure Updates)](https://azure.microsoft.com/updates?id=577678)
- [Mutual TLS authentication with Azure Front Door (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/frontdoor/mutual-tls)
