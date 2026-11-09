---
name: wiremock-stubs
description: >
  WireMock stub creation patterns — folder structure, naming conventions,
  mapping JSON format, priority system, error/override stubs, and step-by-step instructions.
  Use when creating or modifying WireMock stubs for local development, frontend story isolation,
  or integration/E2E test scenarios.
---

# Skill: WireMock Stub Management

Read this skill when you need to create, modify, or understand WireMock stubs in the project.

## When to Create WireMock Stubs

- **Frontend story isolation** — `[frontend]` stories must include WireMock stubs for any new API calls as part of the definition of done
- **New upstream API integration** — when the backend calls a new external service
- **Test scenarios** — error states, empty states, or parameter-specific responses for integration/E2E tests
- **New endpoint mocking** — when a new backend endpoint needs mocked upstream data

## File Structure

All WireMock files live under the **WireMock stubs root** set in `.github/project-config.md` (shown below as `<wiremock-root>/`). How WireMock is hosted — and how new upstream services are registered — depends on the stack; see the backend stack's WireMock hosting skill in `.github/skills/` (for example `wiremock-aspire` for .NET Aspire).

```text
<wiremock-root>/
├── mappings/                              # Stub configuration (request matching rules)
│   ├── {service-name}-stubs.json          # Default stubs (always active)
│   ├── {service-name}-stubs.{scenario}.json.bak  # Override stubs (inactive by default)
│   └── ...
└── __files/                               # Response bodies (JSON data)
    ├── common/                            # Shared responses (empty-array.json, null.json)
    ├── {service}/                          # Per-service responses
    │   └── {resource}/
    │       ├── response.json              # Default success response
    │       ├── {paramValue}.json           # Parameter-specific response
    │       ├── default.json               # Fallback response
    │       └── errors/
    │           ├── {status}.json           # Error by status code
    │           └── {resource}-{status}.json # Resource-prefixed error
    └── ...
```

### Existing Mapping Files

| Mapping File                     | `__files/` Directory | Service URL                            |
| -------------------------------- | -------------------- | -------------------------------------- |
| `svc-api-orders-stubs.json`      | `orders/`            | `http://svc-api-orders`                |
| `svc-api-catalog-stubs.json`     | `catalog/`           | `http://svc-api-catalog`               |
| `svc-api-userprofile-stubs.json` | `userprofile/`       | `http://svc-api-userprofile`           |
| `svc-api-exp-MyApp-stubs.json`   | `MyApp/`             | Self-referencing for integration tests |

### Response File Naming

| Type                    | Pattern                             | Example                       |
| ----------------------- | ----------------------------------- | ----------------------------- |
| Success (200)           | `response.json` or descriptive name | `response.json`, `list.json`  |
| Error (4xx/5xx)         | `errors/{status}.json`              | `errors/401.json`             |
| Resource-prefixed error | `errors/{resource}-{status}.json`   | `errors/list-400.json`        |
| Parameter-specific      | `{paramValue}.json`                 | `102736984.json`, `4700.json` |
| Default fallback        | `default.json`                      | `default.json`                |

## Creating a New Stub — Step by Step

### Step 1: Create the Response Body File

Create a JSON file under the appropriate `__files/` subdirectory:

```text
__files/{service}/{resource}/{descriptiveName}.json
```

Example — a new premium report response:

```json
// __files/payrollreports/premiumreport/105000001.json
{
  "auditNumber": "105000001",
  "status": "Completed",
  "totalPremium": 12500.0
}
```

### Step 2: Add the Stub Mapping

Open the corresponding mapping file in `<wiremock-root>/mappings/` and add an entry to the `mappings` array:

```json
{
  "name": "Premium report - Completed (105000001)",
  "request": {
    "urlPathTemplate": "/audits/{auditNumber}/premiumreport",
    "method": "GET",
    "pathParameters": {
      "auditNumber": {
        "equalTo": "105000001"
      }
    }
  },
  "response": {
    "status": 200,
    "bodyFileName": "payrollreports/premiumreport/105000001.json",
    "headers": {
      "Content-Type": "application/json"
    }
  },
  "priority": 4
}
```

### Step 3: Add a Fallback Stub (if none exists)

Every parameter-specific stub should have a fallback at priority 5:

```json
{
  "name": "Premium report - Default fallback",
  "request": {
    "urlPathTemplate": "/audits/{auditNumber}/premiumreport",
    "method": "GET"
  },
  "response": {
    "status": 200,
    "bodyFileName": "payrollreports/premiumreport/default.json",
    "headers": {
      "Content-Type": "application/json"
    }
  },
  "priority": 5
}
```

## Request Matching

### Path Parameters

Use `urlPathTemplate` with `{placeholders}` and `pathParameters` to match specific values:

```json
{
  "request": {
    "urlPathTemplate": "/policies/{policyNumber}/terms",
    "method": "GET",
    "pathParameters": {
      "policyNumber": {
        "equalTo": "100077641"
      }
    }
  }
}
```

### Query Parameters

Use `queryParameters` for query string matching:

```json
{
  "request": {
    "urlPathTemplate": "/auditschedules",
    "method": "GET",
    "queryParameters": {
      "policynumber": {
        "equalTo": "4700"
      }
    }
  }
}
```

### Body Matching (POST/PUT)

Use `bodyPatterns` for request body matching:

```json
{
  "request": {
    "urlPathTemplate": "/audits/{auditNumber}/submit",
    "method": "POST",
    "bodyPatterns": [
      {
        "matchesJsonPath": "$.auditNumber"
      }
    ]
  }
}
```

## Priority System

Lower number = higher priority. WireMock evaluates stubs in priority order.

| Priority | Use Case                                           |
| -------- | -------------------------------------------------- |
| 1–3      | Override/error-scenario stubs (temporary)          |
| 4        | Parameter-specific stubs (most stubs)              |
| 5        | Default fallback stubs (catch-all)                 |
| 7        | Error responses that should never match by default |

**Rules:**

- Always pair parameter-specific stubs (priority 4) with a fallback (priority 5)
- Keep gaps between priority levels for future inserts
- Same-priority stubs must not match the same request (non-deterministic)

## Override Stubs for Error Testing

Override stubs let you force error responses without editing default stubs.

### Convention

- Filename: `{service}-stubs.{scenario}.json.bak`
- Priority: **3** (wins over all default stubs)
- `.json.bak` = inactive; rename to `.json` to activate

### Creating an Override Stub

1. Create the file with `.json.bak` extension:

```text
mappings/{service}-stubs.{scenario}.json.bak
```

2. Set priority 3 on each stub entry:

```json
{
  "mappings": [
    {
      "name": "Override: Force 500 on premium reports",
      "request": {
        "urlPathTemplate": "/audits/{auditNumber}/premiumreport",
        "method": "GET"
      },
      "response": {
        "status": 500,
        "bodyFileName": "common/server-error.json",
        "headers": {
          "Content-Type": "application/problem+json"
        }
      },
      "priority": 3
    }
  ]
}
```

3. Reuse shared response bodies from `__files/common/` when possible:

| File                      | Content |
| ------------------------- | ------- |
| `common/empty-array.json` | `[]`    |
| `common/null.json`        | `null`  |

### Activating/Deactivating Overrides

```powershell
# Activate (rename off .bak)
Rename-Item "<wiremock-root>/mappings/{file}.json.bak" "{file}.json"

# Deactivate (add .bak back)
Rename-Item "<wiremock-root>/mappings/{file}.json" "{file}.json.bak"
```

Restart the WireMock host after toggling overrides — WireMock loads mappings at startup.

## Adding a New Upstream Service

When the backend integrates with a new external API:

1. **Create the mapping file**: `mappings/{service-name}-stubs.json`
2. **Create the response directory**: `__files/{service}/`
3. **Register the service with the WireMock host** — follow the backend stack's WireMock hosting skill, and point the backend's upstream URL for the service at the mock.
4. Add stubs following the patterns above.

## Frontend Story Isolation

When implementing a `[frontend]` story that calls a new or modified API:

1. Check if a WireMock stub already exists for the endpoint
2. If not, create stubs following Steps 1–3 above
3. Include both success and error response stubs
4. The WireMock stubs are part of the story's definition of done

This ensures the frontend can be developed and tested independently of the backend.

## Checklist

Before submitting WireMock changes:

- [ ] Response files are in the correct `__files/{service}/{resource}/` path
- [ ] Mapping entry uses `bodyFileName` (relative to `__files/`)
- [ ] `Content-Type` header matches response format (`application/json` or `application/problem+json` for errors)
- [ ] Priority is set correctly (4 for specific, 5 for fallback)
- [ ] Parameter-specific stubs have a corresponding fallback stub
- [ ] Override stubs use `.json.bak` extension and priority 3
- [ ] New upstream services are registered with the WireMock host

## Formatting Existing Stubs

Use this workflow for `/formatstub {stubname}` or when standardizing an existing mapping file.
The prompt is a shortcut; this section is the source of truth.

1. Locate `<wiremock-root>/mappings/{stubname}-stubs.json`, using the WireMock root in
   `.github/project-config.md`. If the file cannot be found or the name matches multiple files,
   report that and stop.
2. Inspect the entire mapping file before editing. Report the status-200 mappings and their
   endpoints, all non-empty `pathParameters` blocks with their mapping/status, and candidate
   amount or percentage values with line numbers. Wait for explicit approval before changing
   anything. Obtain approval separately for decimal formatting and path-parameter changes.
3. Format only values that are clearly monetary amounts or percentages, and only when two decimal
   places are required by the domain. Preserve identifiers, counts, years, and other numeric
   fields. Do not infer a replacement for an anomalous value or convert scientific notation to a
   guessed “reasonable” value; ask for the intended value if its meaning is unclear.
4. Empty a non-empty `pathParameters` block only when its own WireMock mapping has a
   `"response"` status of `200`, and only after approval. Replace that block with
   `"pathParameters": {}`. Leave all other statuses, request matching rules, and mappings intact.
5. Preserve all unrelated fields, mapping names, IDs, metadata, and response content. Take care
   that response bodies may contain JSON encoded as strings; avoid rewriting or reserializing
   unrelated content.
6. Validate the resulting mapping file as JSON and, when response bodies contain JSON strings,
   validate those bodies where practical. Review the diff to ensure only approved decimal fields
   and eligible `pathParameters` blocks changed. Report the number and locations of each change
   and any values intentionally left unchanged.
