---
name: pr-review-node-ts
description: "Node.js and TypeScript backend code review patterns — anti-patterns and correctness. Use when reviewing Node/TypeScript backend code changes."
---

# Skill: Node.js / TypeScript Backend Code Review Patterns

Read this skill when reviewing Node.js / TypeScript backend code changes.

## Anti-Patterns to Flag

### Async Handling

```ts
// ❌ Flag: unhandled promise rejection (no await, no .catch)
service.doWork();

// ❌ Flag: swallowed error
try { await doWork(); } catch { /* nothing */ }

// ✅ Use: await it, or handle/rethrow explicitly
await service.doWork();
```

### Typing

```ts
// ❌ Flag: any used to bypass the type system
function handle(payload: any) { ... }

// ✅ Use: a specific type, generic, or unknown + narrowing
function handle(payload: CreateOrderRequest) { ... }
```

### Input Validation

```ts
// ❌ Flag: request body used directly without validation
const { email } = req.body;

// ✅ Use: parse/validate at the boundary
const { email } = createUserSchema.parse(req.body);
```

## Security Checklist

- [ ] Authorization checked before data access, not just authentication.
- [ ] Unauthorized resource access returns 403.
- [ ] No secrets, tokens, or PII in logs.
- [ ] All inputs validated at the API boundary.
