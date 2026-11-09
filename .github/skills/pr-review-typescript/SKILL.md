---
name: pr-review-typescript
description: "TypeScript and React code review patterns — anti-patterns, component usage, and React 19+ correctness. Use when reviewing TypeScript frontend code changes."
---

# Skill: TypeScript / React Code Review Patterns

Read this skill when reviewing TypeScript/React code changes. It covers common anti-patterns, component-library usage, and React 19+ correctness rules.

## TypeScript Anti-Patterns to Flag

### Type Safety

```typescript
// ❌ Flag: any type without justification
const data: any = response;
function process(input: any) { ... }

// ❌ Flag: Non-null assertion without comment explaining why it's safe
const value = maybeNull!.property;

// ❌ Flag: Loose object type instead of specific interface
const policy: object = { id: '123' };
// ✅ Use: const policy: Policy = { id: '123' };

// ❌ Flag: Index signature instead of typed properties
interface Config { [key: string]: string }
// ✅ Prefer explicit property types when the keys are known
```

### Component Patterns

```typescript
// ❌ Flag: Missing memo() on component that receives callbacks
export const PolicyCard = (props: PolicyCardProps) => { ... };
// ✅ Use: export const PolicyCard = memo<PolicyCardProps>((props) => { ... });

// ❌ Flag: Inline function as prop (new reference each render)
<PolicyCard onSelect={() => handleSelect(policy.id)} />
// ✅ Use: useCallback for stable references
const handleSelect = useCallback(() => selectPolicy(policy.id), [policy.id, selectPolicy]);
<PolicyCard onSelect={handleSelect} />

// ❌ Flag: Missing displayName on memo/forwardRef components (breaks DevTools)
// ✅ Add: PolicyCard.displayName = 'PolicyCard';
```

### Hooks

```typescript
// ❌ Flag: useEffect for data fetching (bypasses TanStack Query cache)
useEffect(() => {
  fetch("/api/policies")
    .then((r) => r.json())
    .then(setPolicies);
}, []);
// ✅ Use: useQuery from TanStack Query

// ❌ Flag: Missing or incomplete dependency array
useEffect(() => {
  doSomethingWith(value);
}, []); // value used but not in deps
// ✅ Include all dependencies; use useCallback/useMemo to stabilize references

// ❌ Flag: setState inside useEffect without cleanup — memory leak risk
useEffect(() => {
  fetchData().then((data) => setState(data)); // no cleanup for unmount case
}, []);
```

### State Management

```typescript
// ❌ Flag: Server state in useState/useReducer (duplicates TanStack Query)
const [policies, setPolicies] = useState<Policy[]>([]);
// ✅ Use: const { data: policies } = useQuery(...)

// ❌ Flag: Derived state in useState (stale data risk)
const [fullName, setFullName] = useState(`${firstName} ${lastName}`);
// ✅ Derive in render: const fullName = `${firstName} ${lastName}`;
```

## Component Library / Atomic Design Patterns

```typescript
// ✅ Correct: use the project's class-name utility following Atomic Design
const classes = classNames({
  atomicLevel: 'molecules',
  block: 'itemCard',
  modifiers: ['isSelected', 'isLoading'],
  props,
});

// ❌ Flag: Manual className concatenation instead of the shared utility
className={`itemCard ${isSelected ? 'itemCard--selected' : ''}`}

// ✅ Correct: import components from the project's shared component library
import { Button, Card } from '@myorg/ui';

// ❌ Flag: Direct HTML elements where shared components exist
<button onClick={...}>Submit</button>  // use <Button> from the component library
```

## i18n / Localization Rules

```typescript
// ❌ Flag: Hardcoded string in JSX
<p>No policies found</p>
// ✅ Use: <p>{t('policies.emptyState')}</p>

// ❌ Flag: Hardcoded date format
{new Date(policy.effectiveDate).toLocaleDateString()}
// ✅ Use date-fns with locale: {format(parseISO(policy.effectiveDate), 'PP', { locale })}

// ❌ Flag: Hardcoded currency format
{`$${amount}`}
// ✅ Use: {n(amount, 'currency')} with i18next number formatting
```

## Accessibility Checklist (WCAG 2.1 AA)

For every interactive element in a PR:

```markdown
[ ] Keyboard navigable — all interactions reachable via keyboard
[ ] Focus indicators visible — no outline: none without replacement
[ ] ARIA labels on icon-only buttons and form fields without visible label
[ ] role attribute present where semantic HTML insufficient
[ ] Error messages linked to inputs via aria-describedby
[ ] Images have alt text; decorative images use alt=""
[ ] Color not the only indicator of state (add icon or text)
[ ] Touch targets ≥ 44×44px on mobile
```

## Business Logic Boundary

The frontend must **not** contain business logic. All business rules, calculations, and domain validations belong in the backend API. The frontend is responsible only for UI-level concerns.

```typescript
// ❌ Flag: Business rule validation in frontend
const canRenew = policy.expirationDate <= addDays(new Date(), 90);
const isEligible = employee.hoursWorked >= 1000 && employee.tenure >= 12;
const premium = baseRate * coverageMultiplier * ageFactor;
if (policy.status === "submitted" && user.role === "manager") {
  /* allow approve */
}

// ❌ Flag: Status transition logic in frontend
const nextStatus =
  currentStatus === "draft"
    ? "submitted"
    : currentStatus === "submitted"
      ? "approved"
      : "closed";

// ❌ Flag: Domain-specific calculations in frontend
const proRatedAmount = (annualAmount / 365) * remainingDays;

// ✅ OK: UI-level validation (form UX — instant feedback)
const schema = Yup.object({
  email: Yup.string().email().required(),
  name: Yup.string().max(100).required(),
  startDate: Yup.date().min(new Date(), "Must be a future date").required(),
});

// ✅ OK: Display/presentation logic
const displayName = `${policy.companyName} (${policy.policyNumber})`;
const isOverdue = isPast(parseISO(policy.dueDate)); // for visual indicator only
const formattedAmount = n(policy.premium, "currency");
```

**Rule of thumb:** If removing the logic would change a business outcome (not just the UI), it belongs in the backend.

## TanStack Query Patterns

```typescript
// ✅ Correct: queryKey with stable structure, using constants
import { queryKeys } from "@constants/queryKeys";

const { data, isLoading, error } = useQuery({
  queryKey: [queryKeys.policies, searchCriteria],
  queryFn: () => policyApi.searchPolicies(searchCriteria),
  staleTime: 5 * 60 * 1000,
  enabled: !!searchCriteria,
});

// ❌ Flag: Inline string queryKey (typo-prone, hard to invalidate)
queryKey: ["policies", searchCriteria];

// ✅ Correct: useMutation with optimistic updates where appropriate
const { mutate } = useMutation({
  mutationFn: (data: CreatePolicyRequest) => policyApi.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [queryKeys.policies] });
  },
});
```
