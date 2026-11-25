---
title: "Azure Functions OpenAI 확장 지원 종료: 2027년 4월 20일까지 SDK 직접 호출로 옮긴다"
description: "Azure Functions의 Azure OpenAI 확장이 2027년 4월 20일 지원 종료된다. Preview 번들 4.60.0부터는 이미 빠졌다. 영향받는 바인딩, 당장 앱을 살려 두는 방법, 옮길 방향을 Azure 업데이트와 Learn 문서 기준으로 정리했다."
date: 2026-11-25T09:40:00
update: 2026-11-25T09:40:00
tags:
  - Azure
  - AI
---

Azure Functions에서 프롬프트 완성, 어시스턴트, 임베딩, 시맨틱 검색을 바인딩 하나로 붙여 주던 Azure OpenAI 확장이 지원 종료된다. 11월 20일 Azure 업데이트에 올라온 날짜는 **2027년 4월 20일**이다. 일정만 보면 여유가 있어 보이지만 이미 바뀐 것도 있다. Learn 문서에 따르면 Preview 확장 번들 4.60.0 이상에는 이 확장이 들어 있지 않다. 번들 버전을 `[4.*, 5.0.0)`처럼 열어 둔 앱이라면 다음 배포에서 바인딩이 사라질 수 있다는 뜻이다.

> 이 확장을 쓰는 Functions 앱은 지금 무엇을 막아 두고, 종료일까지 어디로 옮겨야 할까?

> 이 글은 Azure 업데이트 공지(RSS 본문)와 Microsoft Learn의 Azure OpenAI extension for Azure Functions 문서를 읽고 정리했다. 바인딩별 대체 SDK는 문서에 일대일로 나와 있지 않아서, 그 부분은 내가 정리한 방향이다.

## 1. 어떤 바인딩이 사라지나

문서의 표에 나온 바인딩과 트리거는 여덟 개다.

| 용도                               | 바인딩·트리거                                            |
| ---------------------------------- | -------------------------------------------------------- |
| 텍스트 프롬프트 완성               | text completion input binding                            |
| 어시스턴트의 함수 호출 응답        | assistant trigger                                        |
| 어시스턴트 생성, 메시지, 기록 조회 | assistant create output, post input, query input binding |
| 텍스트 임베딩 읽기                 | embeddings input binding                                 |
| 벡터 DB 쓰기와 검색                | embeddings store output, semantic search input binding   |

.NET 격리 워커에서는 `Microsoft.Azure.Functions.Worker.Extensions.OpenAI` 패키지와 벡터 저장소별 애드온(`...OpenAI.AzureAISearch`, `...OpenAI.CosmosDBNoSQLSearch`, `...OpenAI.Kusto` 등)을 쓴다. 다른 언어는 확장 번들로 이 바인딩을 받는다. Go는 원래 지원하지 않았다.

## 2. 번들 4.60.0부터 이미 빠졌다

가장 먼저 볼 곳은 `host.json`이다. 문서의 경고 상자는 Preview 확장 번들 4.60.0과 그 이후 버전에 이 확장이 없다고 적고 있다. 바인딩 정의는 `function.json`이나 데코레이터에 남아 있는데 번들에 구현이 없으면 함수가 제대로 올라오지 않을 것이다.

기존 앱을 당장 살려 두려면 문서가 안내하는 대로 버전 범위를 4.60.0 미만으로 묶는다.

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Preview",
    "version": "[4.*, 4.60.0)"
  }
}
```

.NET 앱은 NuGet 패키지를 직접 참조하고 있으니 번들 변경의 영향은 받지 않는다. 문서도 .NET 앱은 해당 NuGet 패키지를 계속 쓸 수 있다고 적었다. 다만 같은 문단에 **번들을 고정하든 NuGet을 계속 쓰든 2027년 4월 20일 이후로 지원이 늘어나지는 않는다**는 문장이 붙어 있다. 버전 고정은 이전 작업을 할 시간을 버는 수단일 뿐이다.

## 3. 어디로 옮기나

공지와 문서의 안내는 한 문장이다. 시나리오에 따라 OpenAI SDK, Microsoft Foundry SDK, Azure AI Search SDK를 직접 쓰라는 것이다. 바인딩별 대응표는 없어서, 바인딩이 하던 일을 기준으로 이렇게 나눠 봤다.

| 지금 쓰는 바인딩                  | 옮길 방향(정리한 것)                         |
| --------------------------------- | -------------------------------------------- |
| text completion, embeddings input | OpenAI SDK로 모델 직접 호출                  |
| assistant 계열                    | Foundry의 에이전트 API                       |
| embeddings store, semantic search | Azure AI Search SDK(또는 쓰던 벡터 DB의 SDK) |

바인딩을 걷어내면 그동안 확장이 대신 해 주던 일이 함수 코드로 넘어온다. 개인적으로는 이 부분이 일정보다 더 걸렸다.

- 클라이언트 생성과 재사용: 함수 호출마다 새로 만들지 않도록 정적 인스턴스나 DI로 둔다.
- 인증: 문서는 SDK로 옮길 때 고른 SDK의 인증·연결 가이드를 따르라고 한다. 지금 `AIConnectionName`으로 관리 ID를 쓰고 있다면 SDK 쪽에서도 같은 ID와 `Cognitive Services OpenAI User` 역할을 쓰면 된다.
- 재시도와 타임아웃: 확장이 숨겨 주던 동작을 SDK 옵션으로 명시해야 한다.
- 어시스턴트 상태: assistant 바인딩이 저장해 주던 대화 기록을 어디에 둘지 다시 정해야 한다.

## 4. 영향받는 앱 찾기

리포지토리에서 패키지 이름과 번들 설정으로 먼저 걸러 본다. 바인딩 타입 문자열은 언어별 문서마다 달라서, 넓게 `openai`로 찾은 뒤 눈으로 확인하는 편이 빠르다.

```bash
# .NET 패키지 참조
grep -rn "Microsoft.Azure.Functions.Worker.Extensions.OpenAI" --include=*.csproj .

# 바인딩 선언이나 설정에 openai가 들어간 곳
grep -rniI "openai" --exclude-dir=node_modules --exclude-dir=.venv .

# 번들 버전 범위
grep -rn -A3 '"extensionBundle"' --include=host.json .
```

OpenAI SDK를 이미 직접 쓰는 코드도 같이 걸리니, 결과에서 바인딩 선언만 추리면 된다.

### 점검 목록

- [ ] Preview 번들을 쓰는 앱의 버전 범위가 4.60.0 이상을 허용하는가
- [ ] 당장 배포가 필요한 앱은 `[4.*, 4.60.0)`으로 고정했는가
- [ ] 바인딩별로 옮길 SDK를 정했는가
- [ ] 관리 ID와 역할 할당을 SDK 호출에서도 그대로 쓰는가
- [ ] 어시스턴트 대화 기록을 옮길 저장소를 정했는가

## 참고 자료

- [Azure 업데이트: Support for Azure Functions OpenAI Extension ends on April 20, 2027](https://azure.microsoft.com/updates?id=579952)
- [Azure OpenAI extension for Azure Functions](https://learn.microsoft.com/azure/azure-functions/functions-bindings-openai)
