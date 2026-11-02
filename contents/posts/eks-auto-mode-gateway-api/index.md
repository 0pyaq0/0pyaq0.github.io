---
title: "EKS Auto Mode의 Gateway API 지원: 컨트롤러 설치 없이 Gateway로 ALB 띄우기"
description: "EKS Auto Mode가 Kubernetes Gateway API를 기본 지원하기 시작했다. 활성화 방법, GatewayClass 이름, CRD 관리 방식, Ingress와의 공존을 공식 문서 기준으로 정리했다."
date: 2026-11-02T09:40:00
update: 2026-11-02T09:40:00
tags:
  - Kubernetes
  - AWS
---

10월 28일부터 **EKS Auto Mode가 Kubernetes Gateway API를 기본으로 지원한다**. Gateway와 HTTPRoute를 만들면 Auto Mode가 ALB나 NLB를 알아서 만들고 관리한다. 지금까지 EKS에서 Gateway API를 쓰려면 AWS Load Balancer Controller나 다른 구현체를 직접 설치하고 버전을 챙겨야 했다. Auto Mode 클러스터라면 그 단계가 빠진다.

> Auto Mode 클러스터에서 Gateway API를 켜려면 무엇을 설정해야 하고, 기존 Ingress는 어떻게 되는가?

> 이 글은 AWS What's New 공지와 EKS 사용자 가이드의 Gateway API 설정 문서를 읽고 정리했다. 문서에 예시가 없는 기능은 이름만 언급했다.

## 1. 무엇이 들어왔나

공지에 나온 기능 목록은 이렇다.

- HTTP, gRPC 라우팅
- 여러 팀이 쓰는 환경을 위한 네임스페이스 간 라우팅
- 가중치 기반 트래픽 분할, 헤더 기반 라우팅
- AWS Certificate Manager 인증서 자동 탐색

별도 Gateway API 컨트롤러를 설치하거나 설정할 필요가 없다는 점이 가장 크다. 요금은 Auto Mode에 포함되고, 만들어지는 로드밸런서 비용만 평소처럼 나간다. Auto Mode를 지원하는 모든 리전에서 쓸 수 있다.

## 2. 클러스터에서 켜는 방법

Gateway API는 클러스터 설정의 `kubernetesNetworkConfig.elasticLoadBalancing.gatewayApi`로 켠다. 문서의 새 클러스터 예시는 다음과 같다.

```bash
aws eks create-cluster \
  --name $CLUSTER_NAME \
  --role-arn $CLUSTER_ROLE_ARN \
  --resources-vpc-config subnetIds=$SUBNET_IDS \
  --compute-config enabled=true \
  --kubernetes-network-config '{"elasticLoadBalancing":{"enabled":true,"gatewayApi":{"crds":{"managed":true}}}}' \
  --storage-config '{"blockStorage":{"enabled":true}}'
```

기존 클러스터는 `update-cluster-config`로 같은 설정을 넣는다. 서브넷에는 Auto Mode가 퍼블릭·프라이빗을 구분하는 태그가 붙어 있어야 한다. `eksctl`로 만든 클러스터는 이미 붙어 있다.

### CRD를 누가 관리하나

개인적으로는 `crds.managed` 값이 가장 먼저 정해야 할 부분으로 보였다.

| 값      | CRD 설치 주체                 | 주의할 점                     |
| ------- | ----------------------------- | ----------------------------- |
| `true`  | AWS가 Gateway API v1으로 관리 | 이전 버전 CRD가 있으면 거부됨 |
| `false` | 사용자가 직접 설치·업그레이드 | 버전 관리 책임이 넘어옴       |

`true`로 켰는데 클러스터에 이미 예전 버전 Gateway API CRD가 깔려 있으면 작업이 거부되고 아무것도 바뀌지 않는다. 먼저 v1으로 올려야 한다. 다른 구현체를 시험해 보느라 CRD를 설치해 둔 클러스터라면 여기서 걸릴 수 있다.

## 3. GatewayClass부터 Route까지

Auto Mode는 컨트롤러 이름 두 개를 제공한다.

| `controllerName`                | 만들어지는 로드밸런서 | 받는 Route               |
| ------------------------------- | --------------------- | ------------------------ |
| `eks.amazonaws.com/gateway-alb` | ALB (L7)              | `HTTPRoute`, `GRPCRoute` |
| `eks.amazonaws.com/gateway-nlb` | NLB (L4)              | `TCPRoute`, `UDPRoute`   |

흐름은 GatewayClass가 컨트롤러를 고르고, Gateway 하나가 로드밸런서 하나가 되고, Route가 그 위에 규칙을 붙이는 구조다. 문서는 GatewayClass를 먼저 만들라고 한다. 새 GatewayClass가 참조 가능한 상태가 되기까지 약간의 지연이 있기 때문이다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eks-auto-alb
spec:
  controllerName: eks.amazonaws.com/gateway-alb
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-gateway
  namespace: default
spec:
  gatewayClassName: eks-auto-alb
  listeners:
    - name: http
      protocol: HTTP
      port: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
  namespace: default
spec:
  parentRefs:
    - name: my-gateway
      sectionName: http
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: service-2048
          port: 80
```

적용한 뒤에는 Gateway가 `Programmed` 상태가 될 때까지 기다렸다가 주소를 확인한다.

```bash
kubectl wait --for=condition=Programmed gateway/my-gateway
ADDRESS=$(kubectl get gateway my-gateway -o jsonpath='{.status.addresses[0].value}')
curl http://$ADDRESS
```

### AWS 전용 설정

표준 Gateway API에 없는 AWS 설정은 `gateway.k8s.aws/v1` 확장 리소스로 붙인다. AWS Load Balancer Controller가 쓰는 것과 같은 리소스다.

- `LoadBalancerConfiguration`: 서브넷, 보안 그룹, 액세스 로그 등. Gateway나 GatewayClass에 붙인다.
- `TargetGroupConfiguration`: 헬스 체크, 등록 해제 지연, 스티키 세션. Service에 붙인다.
- `ListenerRuleConfiguration`: Cognito나 OIDC 인증 같은 라우팅 규칙. Route에 붙인다.

이 리소스들의 YAML은 Auto Mode 문서에 없고 Load Balancer Controller 가이드로 링크만 걸려 있다.

## 4. Ingress와 기존 구성은 어떻게 되나

기존 `Ingress`와 `type: LoadBalancer` Service는 Gateway API 리소스와 함께 그대로 동작한다. 문서도 점진적으로 옮기면 된다고 적었다. 한 번에 갈아엎을 이유는 없다.

Auto Mode 컨트롤러는 자기만의 컨트롤러 이름을 쓰기 때문에 Envoy Gateway나 Istio 같은 다른 구현체와 같은 클러스터에 공존한다. GatewayClass로 어느 구현체가 처리할지 나뉘는 구조라 충돌하지 않는다.

모든 Gateway API 필드가 AWS 로드밸런서 기능에 대응되지는 않는다. 문서는 AWS Load Balancer Controller v3.5 문서의 ALB Gateway와 표준 Gateway API 비교표를 보라고 안내한다. TLS 리스너나 가중치 분할처럼 공지에는 있지만 Auto Mode 문서에 예시가 없는 기능은 그 비교표로 지원 범위를 먼저 확인하는 게 안전하다.

### 점검 목록

- 클러스터가 Auto Mode인지, 서브넷 태그가 있는지 확인한다
- 기존 Gateway API CRD가 깔려 있는지, 버전이 v1인지 본다
- `crds.managed`를 `true`로 둘지 직접 관리할지 정한다
- 같은 클러스터에 다른 Gateway 구현체가 있다면 GatewayClass 이름을 정리한다
- 쓰려는 필드가 ALB Gateway 비교표에서 지원되는지 확인한다
- Ingress는 그대로 두고 새 서비스부터 HTTPRoute로 시작한다

## 참고 자료

- [Amazon EKS Auto Mode now supports Kubernetes Gateway API](https://aws.amazon.com/about-aws/whats-new/2026/10/amazon-eks-auto-mode-kubernetes-gateway-api/)
- [Configure the Kubernetes Gateway API in EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/auto-configure-gateway-api.html)
