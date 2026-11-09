---
name: acceptance-criteria-backend
description: "Backend API acceptance criteria patterns — JSON examples, test scenarios, error codes, and specification templates. Use when writing or refining backend acceptance criteria for user stories."
---

# Backend API Acceptance Criteria — Detailed Reference

Use this skill when writing or refining backend acceptance criteria for user stories. It provides detailed JSON examples, test scenarios, and specification templates.

## Checklist

### Functional Requirements

- [ ] Business logic requirement described with expected behavior
- [ ] HTTP method, endpoint path, route/query parameters defined
- [ ] Request body schema (POST/PUT/PATCH): required fields, types, validation rules
- [ ] Request headers: Authorization, Content-Type, custom headers

### Response Contract

- [ ] Success response: status code, body schema, field types
- [ ] Error responses: 400 (validation), 403 (access denied), 404 (not found), 409 (conflict), 500
- [ ] Null strategy: optional fields → `null`; empty collections → `[]`
- [ ] Date format: UTC ISO 8601; Enums: string literals; Booleans: `true/false`

### Contract & Mapping

- [ ] API contract/schema defined (per the project's contract approach)
- [ ] Request/response DTOs created
- [ ] Mapper for DTO ↔ domain model

### Authorization & Security

- [ ] Authenticated access enforced (per the project's auth strategy)
- [ ] Role/claim-based access rules defined
- [ ] **401 unauthenticated / 403 unauthorized** distinguished from 404 not found
- [ ] Input sanitization, no PII in logs or responses

### Data & Integration

- [ ] Input validation: required, type, format, length, business rules
- [ ] External service calls via typed clients with retry/circuit-breaker
- [ ] Database queries: async, paginated, no N+1

### Testing

- [ ] Unit tests: service layer, mappers, validation (the project's test, mocking, and test-data libraries — see `.github/project-config.md`)
- [ ] Integration tests: happy path, auth (401 unauthenticated, 403 unauthorized), validation (400), not-found (404)
- [ ] Persona-based testing with different roles
- [ ] One test per behavior (branch, error path, boundary); coverage is reported as a sanity signal, not a target

### Performance & Observability

- [ ] GET < 200ms, POST/PUT < 500ms targets
- [ ] Structured logging with correlation IDs, no PII
- [ ] Async I/O with cancellation propagated through the whole call chain

## API Contract Examples

### Request Body Example

```json
{
  "referenceNumber": "REF-12345",
  "effectiveDate": "2024-01-15T00:00:00Z",
  "status": "Active"
}
```

### Success Response Example (200/201)

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "referenceNumber": "REF-12345",
  "status": "Active",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Standard Error Response Format (400)

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred",
  "status": 400,
  "errors": {
    "referenceNumber": ["Reference number is required"],
    "effectiveDate": ["Date must be in ISO 8601 format"]
  }
}
```

### Response Null Strategy Example

```json
{
  "referenceNumber": "REF-12345",
  "customerName": null, // Optional field, no data → null
  "effectiveDate": "2024-01-15", // Required field, always present
  "attachments": [], // Empty collection → []
  "notes": null // Optional text field, no data → null
}
```

## Error Response Status Codes

| Status | When                                | Note                                |
| ------ | ----------------------------------- | ----------------------------------- |
| 400    | Validation errors                   | Field-level details in `errors`     |
| 401    | No/invalid token                    | Triggers re-authentication flow     |
| 403    | Insufficient permissions            | Authenticated but not authorized    |
| 404    | Resource not found                  | Distinct from 403 by default        |
| 409    | Duplicate/conflict                  | e.g., duplicate reference number    |
| 500    | Unexpected server error             | Never leak stack traces             |

## Input Validation Checklist

- Required field validation
- Data type validation (string, number, boolean, date, enum)
- Format validation (email, phone, URL, UUID, ISO date)
- Length constraints (min/max string length, array size)
- Value constraints (min/max numeric, allowed enum values)
- Business rule validation (e.g., end date > start date)

### Null/Empty Handling in Requests

- Required fields: Reject `null` or empty with 400
- Optional fields: Accept `null`, empty string, or omitted?
- Arrays: Accept `null`, `[]`, or reject null arrays?

## Output Data Formatting Rules

- **Date/DateTime**: Always UTC ISO 8601 (`2024-01-15T10:30:00Z`)
- **Decimal/Money**: Specify precision (e.g., 2 decimal places)
- **Booleans**: `true/false` (not strings or numbers)
- **Enums**: String literals preferred
- **Empty collections**: Return `[]` not `null`
- **Optional fields with no data**: Return `null`

## Authorization Specification

- OIDC Bearer token via your identity provider
- Role-based (RBAC): Which roles can access?
- Resource-based: Can user access this specific resource?
- Claim-based: Specific claims required (e.g., `resource:read`)?
- Implement at the project's authorization extension point (see `.github/project-config.md`)
- Return 403 for authorized-but-forbidden access by default (check `.github/project-config.md` for any project-specific convention)

## Testing Requirements Template

### Unit Tests

- Service layer: happy path + edge cases + error scenarios
- Mapper tests: DTO↔domain correctness, null handling
- Validation tests: required fields, format, business rules

### Integration Tests

One test per scenario, named in the project's convention (see the stack's test-api-patterns skill):

```text
Happy path            GET /api/v1/{resources}/{id} as an authorized user    → 200, body matches the {resource}
Authorization         {resource} exists, user lacks access                   → 403
Validation error      POST /api/v1/{resources} with missing required fields  → 400 with field-level errors
Null/empty handling   POST with optional fields set to null                  → 201, nulls handled in the response
```

### Persona-Based Testing

Test with different personas/roles configured for your project (e.g., Admin, Regular User, Superuser):

- Verify data filtering based on user's accessible resources
- Test cross-organizational access restrictions

## Performance Targets

- GET responses: < 200ms
- POST/PUT responses: < 500ms
- Stateless design (no in-memory session state)
- Connection pooling for DB and HTTP clients
- Async/await throughout, no blocking calls

## Observability Checklist

- Structured logging with correlation IDs
- Log business events (resource created, document uploaded)
- Never log PII, passwords, or tokens
- Health checks: `/health` endpoint
- Metrics: request duration, error rates, external call latency

## External Service Integration

- Use the project's generated, type-safe clients (see `.github/project-config.md` for their location)
- Error handling: retry with exponential backoff, circuit breaker
- Map downstream errors to appropriate API responses
- Consider caching strategy for downstream responses