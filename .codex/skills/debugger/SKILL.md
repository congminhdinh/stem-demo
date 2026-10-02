---
name: debugger
description: Diagnose and fix software failures in this ASP.NET Core MVC solution. Use when Codex needs to reproduce bugs, analyze logs or stack traces, isolate root causes, implement fixes, validate regressions, or explain failure modes.
---

# Debugger

## Project Baseline

Use this skill for bug diagnosis and repair in `VuiCungWorldCup2026`.

- `Web/` failures often involve routing, model binding, Razor rendering, middleware, dependency injection, configuration, or browser behavior.
- `Application/` failures often involve validation, service orchestration, DTO mapping, filtering, paging, and result handling.
- `Domain/` failures often involve invariants, scoring rules, value objects, state transitions, and guard clauses.
- `Infrastructure/` failures often involve EF Core configuration, migrations, queries, identity, tracking, connection strings, and seed data.

## Workflow

1. Capture the symptom:
   - Record the exact error, stack trace, route, input, environment, browser state, and recent changes.
   - Identify expected behavior, actual behavior, user impact, and frequency.
   - Avoid fixing from the error message alone when a reproduction is possible.
2. Reproduce and reduce:
   - Run the smallest command, test, browser flow, or endpoint call that demonstrates the bug.
   - Isolate whether the failure is in UI, controller, service, domain rule, persistence, configuration, or environment.
   - Minimize test data and inputs until the failing condition is clear.
3. Form and test hypotheses:
   - Inspect code paths from boundary to persistence or back.
   - Check nullability, model validation, date/time assumptions, enum values, soft deletion filters, identity assumptions, and EF tracking.
   - Use logs, debugger output, focused assertions, or temporary local experiments to collect evidence.
4. Implement the smallest fix:
   - Fix the root cause, not only the symptom.
   - Keep edits scoped to affected behavior.
   - Add a regression test when practical, especially for domain rules, application services, and fixed edge cases.
   - Remove any temporary diagnostics before delivery.
5. Validate:
   - Re-run the reproduction.
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run targeted tests or browser checks when relevant.
   - Check adjacent side effects introduced by the fix.

## Common Failure Patterns

- Off-by-one or round-boundary errors in World Cup rules.
- Incorrect prediction scoring or status transitions.
- DTO mapping omissions between `Domain` and `Application`.
- Missing server-side validation behind Razor forms.
- EF Core relationship, required-field, tracking, migration, or seed-data mismatch.
- Identity role or authorization assumptions that differ between development and production.
- Async calls blocked or not awaited.
- Configuration values present locally but absent in another environment.

## Delivery Notes

State the root cause, the fix, the proof that the fix works, and any remaining uncertainty. If reproduction was not possible, say exactly what evidence was available and what still needs to be observed.
