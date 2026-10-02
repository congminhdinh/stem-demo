---
name: qa-expert
description: Plan, evaluate, and improve software quality in this ASP.NET Core MVC solution. Use when Codex needs test strategy, coverage gap analysis, manual or automated QA planning, acceptance criteria validation, regression risk assessment, quality metrics, release readiness, or API/UI/security/performance testing guidance.
---

# QA Expert

## Project Baseline

Use this skill for quality-focused work in `VuiCungWorldCup2026`.

- `Web/` contains MVC controllers, Razor UI, middleware, and app configuration.
- `Application/` contains services, DTOs, requests, specifications, and use-case logic.
- `Domain/` contains entities, value objects, rules, enums, and domain exceptions.
- `Infrastructure/` contains EF Core persistence, identity integration, migrations, and dependency injection.
- The solution currently may not contain a dedicated test project; verify the tree before assuming one exists.
- Respect `agent/coding-rules.md`: define success criteria, keep changes surgical, and verify the outcome.

## Workflow

1. Define quality scope:
   - Clarify the user-facing workflow, API behavior, or domain rule under test.
   - Identify acceptance criteria, risk level, release impact, and affected layers.
   - Search existing tests, scripts, CI, and issue history before proposing new structure.
2. Assess coverage and risk:
   - Map happy paths, edge cases, invalid input, permission boundaries, and concurrency or persistence risks.
   - Include API, Razor UI, domain rules, data validation, security, accessibility, and performance where relevant.
   - Treat missing tests around core scoring, predictions, matches, identity, and persistence as high-signal gaps.
3. Design focused QA:
   - Prefer small automated tests for deterministic domain and application behavior.
   - Use integration or browser checks when MVC routing, model binding, Razor output, auth, or JavaScript behavior matters.
   - Keep manual test charters concise for exploratory, usability, localization, and release smoke coverage.
4. Implement or guide testing:
   - Add test projects only when the request justifies code changes and no existing test harness exists.
   - Keep test data explicit and readable.
   - Cover boundaries, failure modes, and regression cases tied to the change.
   - Avoid brittle assertions that depend on unrelated formatting or ordering.
5. Verify and report:
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run targeted tests when present or newly added.
   - Exercise critical MVC flows or endpoints when practical.
   - Summarize remaining quality gaps plainly.

## QA Focus Areas

- Requirements: confirm behavior is testable, observable, and aligned with user expectations.
- Domain rules: verify World Cup rounds, prediction scoring, score breakdowns, and state transitions.
- Application services: verify validation, result shapes, paging, filtering, mapping, and error handling.
- Infrastructure: verify EF configuration, query behavior, migrations, soft deletion, audit fields, and identity assumptions.
- Web UI: verify model binding, validation messages, navigation, accessibility, responsive states, and browser behavior.
- Regression: protect fixed bugs with the smallest reliable automated test.
- Release readiness: define smoke tests, rollback-sensitive areas, and go/no-go risks.

## Delivery Notes

Report the assessed quality surface, tests or checks performed, coverage gaps, and concrete next steps. If no automated test harness exists, say that explicitly and recommend the smallest useful starting point.
