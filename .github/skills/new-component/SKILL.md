---
name: new-component
description: "React component implementation following Atomic Design. Use when creating a new frontend component."
---

# New Component Implementation Pattern

## Atomic Design Structure

```text
src/MyApp.Frontend/src/components/
├── atoms/        # Basic building blocks (Button, Input, Label, Icon)
├── molecules/    # Simple combinations (FormField, SearchBar, StatusBadge)
├── organisms/    # Complex components (PolicyCard, AuditTable, NavigationHeader)
└── templates/    # Page layouts (DashboardLayout, DetailPageLayout)

src/MyApp.Frontend/src/pages/     # Page-level components
src/MyApp.Frontend/src/hooks/     # Custom React hooks (use*.ts)
src/MyApp.Frontend/src/services/  # API client services
src/MyApp.Frontend/src/types/     # TypeScript types (*.types.ts)
```

## Component Pattern

```tsx
// PolicyCard.tsx
import type { PolicySummary } from "../../types/policy.types";

interface PolicyCardProps {
  policy: PolicySummary;
  onSelect?: (policyId: string) => void;
}

export function PolicyCard({ policy, onSelect }: PolicyCardProps) {
  return (
    <article className="policy-card" aria-label={`Policy ${policy.number}`}>
      {/* implementation */}
    </article>
  );
}
```

## Custom Hook Pattern

```typescript
// usePolicy.ts
import { useQuery } from "@tanstack/react-query";
import { policyService } from "../services/policyService";

export function usePolicy(policyNumber: string) {
  return useQuery({
    queryKey: ["policy", policyNumber],
    queryFn: () => policyService.getPolicy(policyNumber),
    enabled: !!policyNumber,
  });
}
```

## Service Pattern

```typescript
// policyService.ts
import type { PolicyDetail } from "../types/policy.types";

const BASE_URL = "/api/policies";

export const policyService = {
  async getPolicy(policyNumber: string): Promise<PolicyDetail> {
    const response = await fetch(`${BASE_URL}/${policyNumber}`);
    if (!response.ok)
      throw new Error(`Failed to fetch policy: ${response.status}`);
    return response.json() as Promise<PolicyDetail>;
  },
};
```

## Unit Test Pattern

```tsx
// PolicyCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PolicyCard } from "./PolicyCard";
import type { PolicySummary } from "../../types/policy.types";

const mockPolicy: PolicySummary = {
  number: "POL-001",
  status: "Active",
  effectiveDate: "2025-01-01",
};

describe("PolicyCard", () => {
  it("renders policy number", () => {
    render(<PolicyCard policy={mockPolicy} />);
    expect(screen.getByRole("article")).toBeInTheDocument();
    expect(screen.getByText("POL-001")).toBeVisible();
  });

  it("calls onSelect with policy number when clicked", async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <PolicyCard policy={mockPolicy} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("article"));
    expect(onSelect).toHaveBeenCalledWith("POL-001");
  });

  it("renders in accessible state", () => {
    render(<PolicyCard policy={mockPolicy} />);
    expect(screen.getByRole("article")).toHaveAccessibleName(/Policy POL-001/i);
  });
});
```

## Implementation Checklist

For every new component, create these files:

```text
1. src/components/{level}/{Name}/{Name}.tsx          ← component
2. src/types/{domain}.types.ts                       ← types (or add to existing)
3. src/hooks/use{Name}.ts                            ← hook (if data fetching needed)
4. src/services/{domain}Service.ts                   ← service (if new API calls needed)
5. src/components/{level}/{Name}/{Name}.test.tsx      ← unit tests
```

Interactive elements (buttons, links, toggles) have a touch target of at least 44×44 px by default.

## Required Test Coverage Per Component

- [ ] Renders correctly with required props
- [ ] User interaction triggers expected callback
- [ ] Accessibility: ARIA labels, keyboard navigation
- [ ] Loading state renders correctly
- [ ] Error state renders user-friendly message
- [ ] Empty state renders appropriately
