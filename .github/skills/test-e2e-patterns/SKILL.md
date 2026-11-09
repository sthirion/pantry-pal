---
name: test-e2e-patterns
description: "Playwright E2E test patterns — authentication, Page Object Model, persona-based testing, and environment tagging. Use when writing end-to-end tests."
---

# Skill: Playwright E2E Test Patterns

Read this skill when writing Playwright E2E tests. It covers authentication, Page Object Model, persona-based testing, and environment tagging.

## Test Structure

```typescript
import { test, expect } from "@playwright/test";
import { PolicyPage } from "../page-objects/policy.page";

test.describe("Policy Management", () => {
  test("should display policy details @TEST @QA @UAT @PROD", async ({
    page,
  }) => {
    // Arrange
    const policyPage = new PolicyPage(page);
    await policyPage.goto("test-policy-001");

    // Act
    await policyPage.clickSection("full-details");

    // Assert
    await expect(policyPage.detailsSection).toBeVisible();
  });
});
```

## Page Object Model

```typescript
// page-objects/policy.page.ts
export class PolicyPage {
  constructor(private page: Page) {}

  // Locators — prefer data-testid over CSS/text
  get detailsSection() {
    return this.page.locator('[data-testid="policy-details"]');
  }
  get navigationMenu() {
    return this.page.locator('[data-testid="policy-nav"]');
  }
  get submitButton() {
    return this.page.locator('[data-testid="submit-btn"]');
  }
  get errorMessage() {
    return this.page.locator('[data-testid="error-message"]');
  }

  // Actions
  async goto(policyId: string) {
    await this.page.goto(`/app/policy/${policyId}`);
  }

  async clickSection(sectionName: string) {
    await this.page.click(`[data-testid="${sectionName}-link"]`);
  }
}
```

## Authentication — Session Reuse Pattern

When **E2E authentication** in `.github/project-config.md` is `none`, skip this section and **Persona-Based Testing**: no personas, storage states or auth helpers.

Session reuse delivers 80-90% performance improvement. Always use it.

```typescript
import { AuthenticatedSessionManager } from "../utils/authenticated-session-manager";

// Custom fixture that provides authenticated page
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ browser }, use) => {
    const { page } = await AuthenticatedSessionManager.getAuthenticatedPage(
      browser,
      "user", // persona
      false, // forceReauth: true only for auth-specific tests
    );
    await use(page);
  },
});
```

## Persona-Based Testing

```typescript
import { TestConfig } from "../utils/test-config";

test.describe("Role-Based Access", () => {
  test("standard user sees own records only", async ({ browser }) => {
    const { page } = await AuthenticatedSessionManager.getAuthenticatedPage(
      browser,
      "user",
    );
    // assertions...
  });

  test("admin sees all records", async ({ browser }) => {
    test.skip(!TestConfig.hasPersona("admin"), "Admin persona not configured");
    const { page } = await AuthenticatedSessionManager.getAuthenticatedPage(
      browser,
      "admin",
    );
    // assertions...
  });
});
```

## Environment Tags

Tag every test with the environments it should run in:

| Tag     | Environments           |
| ------- | ---------------------- |
| `@TEST` | CI test environment    |
| `@QA`   | QA environment         |
| `@UAT`  | UAT environment        |
| `@PROD` | Production smoke tests |

Destructive or write tests should NOT have `@PROD`.

## Test Data

```typescript
export const TestData = {
  urls: {
    home: `${getBaseURL()}/app/`,
    getPolicyUrl: (id: string) => `${getBaseURL()}/app/policy/${id}`,
  },
  policies: {
    validId: "test-policy-001",
    notFoundId: "does-not-exist-999",
  },
};
```

## Required Scenarios Per Feature

```markdown
[ ] Happy path — user can complete the primary action end-to-end
[ ] Auth boundary — unauthenticated user is redirected to login
[ ] Error state — server error or validation failure shows user-friendly message
[ ] Accessibility — page passes axe-playwright WCAG 2.1 AA check
[ ] Empty state — collection page with no data shows empty state message
```

## Accessibility Check Pattern

```typescript
import { injectAxe, checkA11y } from "axe-playwright";

test("page passes WCAG 2.1 AA @TEST @QA", async ({ page }) => {
  await page.goto("/app/");
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
```

## API + UI Correlation Pattern

```typescript
test("policy details from API match UI display", async ({ page, request }) => {
  const policyId = TestData.policies.validId;

  // Fetch from API directly
  const apiResponse = await request.get(`/api/policies/${policyId}`);
  const policyData = await apiResponse.json();

  // Verify UI shows same data
  await page.goto(TestData.urls.getPolicyUrl(policyId));
  await expect(page.locator('[data-testid="policy-number"]')).toHaveText(
    policyData.policyNumber,
  );
});
```

## Anti-Patterns to Avoid

```typescript
// ❌ Hardcoded waits — use Playwright auto-waiting instead
await page.waitForTimeout(2000);
// ✅ Use: await expect(locator).toBeVisible();

// ❌ CSS selectors or text selectors — brittle
page.locator(".policy-card-title");
page.getByText("Policy Details");
// ✅ Use: page.locator('[data-testid="policy-card-title"]');

// ❌ Tests that depend on execution order
// ✅ Each test sets up its own state independently

// ❌ Shared mutable state between tests
// ✅ Use test.beforeEach() or custom fixtures for isolation
```
