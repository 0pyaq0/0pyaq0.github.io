---
title: "Azure Container Apps 로그 대상 레거시 전환: Log Analytics에서 Azure Monitor로 옮길 때 깨지는 것들"
description: "Container Apps의 Log Analytics 로그 대상이 레거시가 됐다. _CL 테이블 이름과 컬럼이 바뀌고 알림이 끊기는 지점을 공식 마이그레이션 문서 기준으로 정리했다."
date: 2026-10-31T09:40:00
update: 2026-10-31T09:40:00
tags:
  - Azure
  - DevOps
---

Microsoft가 10월 28일 Azure Container Apps의 **Log Analytics 로그 대상(logging destination)을 레거시 옵션으로 돌렸다**. 지금 쓰는 환경은 그대로 동작하지만, 앞으로는 Azure Monitor 대상으로 옮기라고 권한다. 문제는 옮기는 순간 테이블 이름과 컬럼 이름이 같이 바뀐다는 점이다. 로그 쿼리, 대시보드, 알림이 `ContainerAppConsoleLogs_CL`을 보고 있다면 전환 직후부터 새 데이터가 안 들어온다.

> 로그 대상을 Azure Monitor로 바꾸면 무엇이 깨지고, 어떤 순서로 옮겨야 로그가 비지 않는가?

> 이 글은 Azure Updates 공지와 Microsoft Learn의 Container Apps 로그 옵션 문서, 마이그레이션 가이드를 읽고 정리했다. 문서 내용은 2026년 8월 기준이다.

## 1. 왜 레거시가 됐나

기존 Log Analytics 대상은 내부적으로 Azure Monitor의 HTTP Data Collector API를 써서 콘솔 로그와 시스템 로그를 커스텀 테이블에 넣는 방식이었다. 이 API가 2026년 9월 14일로 지원이 끝났다. 공식 문서 표현으로는 TLS 요건을 맞춘 클라이언트의 수집은 계속되지만, 이후로는 중요한 보안 수정만 나온다. 앱에서 이 API를 직접 호출한다면 그건 Logs Ingestion API로 따로 옮겨야 한다.

`stdout`, `stderr`로 찍는 앱이라면 코드 수정은 보통 필요 없다. 바뀌는 건 환경 설정과 로그를 읽는 쪽이다. Express 환경 모드는 아직 Azure Monitor 대상을 지원하지 않아 이번 대상이 아니다.

## 2. 로그 대상 세 가지

Container Apps 환경의 로그 대상은 환경 단위로 하나만 고른다.

| 대상            | 저장 방식            | 비고               |
| --------------- | -------------------- | ------------------ |
| `log-analytics` | 커스텀 `_CL` 테이블  | 이번에 레거시가 됨 |
| `azure-monitor` | 진단 설정으로 라우팅 | 여러 목적지 가능   |
| `none`          | 저장 안 함           | 로그 스트림만 가능 |

Azure Monitor 대상은 진단 설정(diagnostic settings)을 거쳐 Log Analytics 작업 영역, 스토리지, Event Hub, 파트너 솔루션으로 보낸다. 진단 설정은 환경당 최대 5개다.

## 3. 테이블과 컬럼이 어떻게 바뀌나

전환하면 로그가 리소스별(resource-specific) 테이블로 들어간다. 테이블 이름에서 `_CL`이 빠지고, 컬럼 이름 뒤의 타입 접미사(`_s`, `_g`, `_d`)도 빠진다.

| 구분               | 기존                         | 전환 후                   |
| ------------------ | ---------------------------- | ------------------------- |
| 콘솔 로그 테이블   | `ContainerAppConsoleLogs_CL` | `ContainerAppConsoleLogs` |
| 시스템 로그 테이블 | `ContainerAppSystemLogs_CL`  | `ContainerAppSystemLogs`  |
| 앱 이름            | `ContainerAppName_s`         | `ContainerAppName`        |
| 로그 본문          | `Log_s`                      | `Log`                     |

`RevisionName_s`, `ReplicaName_s`, `ContainerId_g` 같은 나머지 컬럼도 같은 규칙이다. 다만 문서는 예시를 완전한 호환 스키마로 보지 말라고 경고한다.

쿼리는 이렇게 바뀐다.

```kusto
// 기존
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "my-app"
| where Log_s contains "error"
| project TimeGenerated, Log_s, RevisionName_s

// 전환 후
ContainerAppConsoleLogs
| where ContainerAppName == "my-app"
| where Log contains "error"
| project TimeGenerated, Log, RevisionName
```

개인적으로는 JSON 로그가 더 걸렸다. Azure Monitor 대상은 `dynamicJsonColumns`를 지원하지 않아서 직접 풀어야 한다.

```kusto
ContainerAppConsoleLogs
| extend Parsed = parse_json(Log)
| where tostring(Parsed.level) == "Error"
```

## 4. 전환 순서

가이드의 흐름은 의존성 조사, 전환, 진단 설정, 검증, 알림 이전 순이다.

### 의존성 찾기

두 `_CL` 테이블을 참조하는 곳을 모두 찾는다. 텍스트 검색만으로는 부족하고 작업 영역 함수, IaC, 파이프라인, SIEM 규칙까지 봐야 한다고 가이드는 짚는다.

### 대상 변경과 진단 설정

CLI로는 대상을 바꾸고 **바로 이어서** 진단 설정을 만든다.

```bash
az provider register --namespace Microsoft.Insights --wait

az containerapp env update \
  --name <ENVIRONMENT_NAME> \
  --resource-group <RESOURCE_GROUP_NAME> \
  --logs-destination azure-monitor

az monitor diagnostic-settings create \
  --name <NEW_UNIQUE_DIAGNOSTIC_SETTING_NAME> \
  --resource <ENVIRONMENT_RESOURCE_ID> \
  --logs '[{"category":"ContainerAppConsoleLogs","enabled":true},{"category":"ContainerAppSystemLogs","enabled":true}]' \
  --workspace <LOG_ANALYTICS_WORKSPACE_RESOURCE_ID>
```

목적지는 기존 `_CL` 테이블이 있는 작업 영역으로 잡아야 과거 데이터와 함께 조회하기 편하다. 기존 진단 설정을 이 명령으로 덮어쓰지는 말라는 주의도 있다.

### 검증

전환 전부터 5분마다 마커를 `stdout`에 찍어 두고, 새 테이블에서 마커가 두 개 이상 보이고 최신 것이 10분 이내면 통과다. 시스템 로그는 이벤트가 있을 때만 생기니 비어 있어도 실패는 아니다.

## 5. 로그가 비는 지점

- 진단 설정 활성화에 최대 90분이 걸린다. 전환 직후 설정을 만들어야 콘솔 로그가 백필된다.
- 시스템 로그는 백필이 보장되지 않는다.
- `_CL` 테이블을 보는 알림은 전환 순간 새 데이터를 잃는다.
- 과거 데이터는 옮겨지지 않고 보존 기간 동안 `_CL`에 남는다.

과도기에는 두 테이블을 `union`으로 묶어 조회하면 된다. 데이터를 옮기진 않는다.

```kusto
union
(
    ContainerAppConsoleLogs_CL
    | project TimeGenerated, ContainerAppName = ContainerAppName_s,
        RevisionName = RevisionName_s, Log = Log_s, SourceTable = "ContainerAppConsoleLogs_CL"
),
(
    ContainerAppConsoleLogs
    | project TimeGenerated, ContainerAppName, RevisionName, Log, SourceTable = "ContainerAppConsoleLogs"
)
```

### 점검 목록

- 환경의 현재 로그 대상이 `log-analytics`인지 확인했다
- `_CL` 참조 쿼리, 알림, IaC를 목록으로 만들었다
- 대상 변경 직후 진단 설정을 같은 작업 영역으로 만든다
- `dynamicJsonColumns`에 기대던 쿼리를 `parse_json`으로 바꿨다
- 검증 후에 알림을 새 테이블로 옮긴다

## 참고 자료

- [Announcing: Migrate Azure Container Apps logging destination from Log Analytics to Azure Monitor](https://azure.microsoft.com/updates?id=577689)
- [Migrate Azure Container Apps logs to Azure Monitor](https://learn.microsoft.com/azure/container-apps/migrate-logs-azure-monitor?pivots=azure-portal)
- [Log storage and monitoring options in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/log-options)
- [Monitor logs in Azure Container Apps with Log Analytics](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring)
