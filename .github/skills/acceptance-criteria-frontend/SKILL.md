---
name: acceptance-criteria-frontend
description: "Frontend acceptance criteria patterns — UI decision matrices, data handling, empty states, and type safety. Use when writing or refining frontend acceptance criteria for user stories."
---

# Frontend Acceptance Criteria — Detailed Reference

Use this skill when writing or refining frontend acceptance criteria for user stories. It provides UI decision matrices, data handling patterns, and empty state guidance.

## Checklist

### Functional Requirements

- [ ] Specific, testable requirements listed
- [ ] UI mockup/screenshot referenced

### Accessibility (WCAG 2.1 AA)

- [ ] Keyboard navigation works
- [ ] E2E covers keyboard-only use and, when the layout changes, the responsive breakpoints
- [ ] Screen reader compatible (ARIA roles/labels)
- [ ] Color contrast ≥ 4.5:1 for text
- [ ] Focus indicators visible

### API Response Handling

- [ ] Frontend types match the backend response contract
- [ ] Null/undefined field handling defined (show fallback vs hide)
- [ ] Empty collections: show "No items" message
- [ ] Server-state loading/error/empty handled: loading → skeleton, error → retry button, empty → message

### Data Formatting

- [ ] Dates formatted with the project's locale-aware date utility
- [ ] Numbers formatted with `Intl.NumberFormat` (or the project's i18n number formatting)
- [ ] Enums mapped to display text through the project's i18n library
- [ ] Text truncation with ellipsis for long content

### Error Handling

- [ ] 400 → field-level validation errors inline
- [ ] 403 → "Access denied" page or message
- [ ] 404 → "Not found" page or redirect
- [ ] 500 → generic error with retry button
- [ ] Page-level error handling (e.g. error boundaries where the framework supports them)

### Testing

- [ ] One test per behavior (conditional render, interaction, loading/error/empty state); coverage is a sanity signal, not a target
- [ ] Loading, error, and success states tested
- [ ] No new console errors/warnings

### Performance

- [ ] Bundle impact < 5KB per new component
- [ ] Large lists use virtualization or pagination
- [ ] No unnecessary re-renders

## Response Type Safety

- Generated client types (see `.github/project-config.md` for the client location)
- Types must match actual backend response structure
- No manual type overrides unless absolutely necessary

### Data Type Mapping

| Backend Type | Frontend Type        | Notes                           |
| ------------ | -------------------- | ------------------------------- |
| DateTime     | string (ISO 8601)    | Format with a locale-aware date utility |
| decimal      | number               | Check precision requirements    |
| bool         | boolean              | Never `"true"/"false"` strings  |
| enum         | string literal union | Map to display text via i18n    |

## Null/Empty Handling — UI Decision Matrix

```text
Field: customerName
- null → Show "Not assigned"
- "" → Show "Not assigned"
- "John Doe" → Show "John Doe"

Field: effectiveDate
- null → Show "Pending activation"
- valid date → Show formatted date

Field: attachments[]
- null → Hide attachments section
- [] → Show "No attachments available"
- [items] → Show list of attachments
```

### General Rules

- `null` optional text → Show fallback ("Not provided", "N/A", "--")
- `0` numeric → Display "0" (don't treat as empty)
- `[]` collection → Show "No items" message
- Missing optional field → Show placeholder or omit from UI
- Business-logic nulls → Document specific meaning (e.g., `null` status = "Pending")

## Server-State Handling

```text
States to handle for every data request (whatever the data-fetching library):
loading          → Show skeleton/spinner
error            → Show error message + retry button
data is null     → Show "No data available" empty state
data is []       → Show "No items found" empty state
filtered to []   → Show "No results" with filter reset option
```

### Empty State UX Requirements

- Provide clear messaging: Why is data empty? (permissions, filters, truly empty)
- Offer actionable next steps: "Create new item", "Clear filters", "Contact support"
- Differentiate: "Loading..." vs "No data yet" vs "Access denied" vs "Error occurred"

## Data Transformation Patterns

### Display Formatting

- **Dates**: ISO → display format with the project's locale-aware date utility
- **Numbers**: Thousands separators, decimal places, currency symbols via `Intl.NumberFormat`
- **Text**: Truncation with ellipsis for long text, HTML sanitization if rendering user content
- **Enums**: Map backend codes to user-friendly text through the project's i18n library

### Derived Fields

- Computed fields: `isExpired`, `daysRemaining`, `displayStatus`
- Conditional display based on field values
- Nested data extraction with safe access (`response?.data?.policy?.details`)

## Error Response Handling

| Backend Status | Frontend Behavior                         |
| -------------- | ----------------------------------------- |
| 400            | Show field-level validation errors inline |
| 403            | Show "Access denied" page or message      |
| 404            | Show "Not found" page or redirect         |
| 500            | Show generic error with retry button      |

Note: Backend returns 403 for access denied and 404 for not found by default — check `.github/project-config.md` if the project uses a different convention.

## Performance Considerations

- Response size: Prefer backend filtering over client-side
- Large lists: Virtual scrolling or pagination
- Image/file URLs: Handle pre-signed URLs or auth headers
- Bundle impact: Target < 5KB per new component

## Accessibility Requirements (WCAG 2.1 AA)

- Keyboard navigation works for all interactive elements
- Screen reader compatible (proper ARIA roles, labels)
- Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components
- Focus indicators visible on all focusable elements
- Interaction states: hover, focus, active, disabled

## Testing Checklist

- Frontend types match the backend response (generated client types where the project has them)
- Page-level error handling for unexpected response shapes
- One test per behavior; coverage is a sanity signal, not a target
- Server-state loading, error, and success states all tested
- No new console errors/warnings
- Responsive: key breakpoints if layout-sensitive
