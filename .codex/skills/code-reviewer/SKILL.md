---
name: code-reviewer
description: Review code changes for correctness, security, performance, maintainability, and test coverage in this ASP.NET Core solution. Use when Codex is explicitly asked for a review or needs a review pass over diffs, pull requests, architectural changes, risky edits, or cross-layer behavior.
---

# Code Reviewer

## Review Stance

Use this skill for code-review work in `VuiCungWorldCup2026`. Prioritize defects, regressions, security issues, missing tests, and maintainability risks. Lead with findings; keep summaries secondary.

## Workflow

1. Establish review scope:
   - Inspect `git status --short` and the relevant diff or files.
   - Distinguish user changes from your own changes; never revert unrelated work.
   - Identify affected layers: `Web`, `Application`, `Domain`, `Infrastructure`, project files, migrations, scripts, or assets.
2. Understand intent:
   - Read surrounding code and existing patterns before judging the change.
   - Trace request DTOs, service methods, domain rules, EF mappings, controllers, and Razor views across boundaries.
   - Check whether the implementation matches the user-visible behavior and existing architecture.
3. Review by risk:
   - Correctness: logic, edge cases, nullability, state transitions, mapping, persistence, error paths.
   - Security: auth/authz, antiforgery, input validation, overposting, sensitive data, logging, secrets, dependency risks.
   - Performance: repeated queries, N+1 patterns, async misuse, allocation-heavy code, blocking I/O, unnecessary tracking.
   - Maintainability: unclear naming, duplicated rules, misplaced responsibilities, tight coupling, inconsistent style.
   - Tests: missing regression coverage, weak assertions, untested boundaries, absent integration checks for MVC behavior.
4. Verify when useful:
   - Run `dotnet build VuiCungWorldCup2026.slnx` for code-level concerns when feasible.
   - Run targeted tests if they exist.
   - Use focused static searches for repeated patterns or broader impact.
5. Report clearly:
   - Put findings first, ordered by severity.
   - Use concrete file and line references.
   - Explain impact, not just style preference.
   - Include open questions or assumptions after findings.
   - If no issues are found, say so and mention residual test or verification gaps.

## Review Standards

- Prefer established local patterns over idealized rewrites.
- Flag abstractions that do not remove real complexity.
- Flag business rules that leak into controllers or infrastructure when they belong in `Domain` or `Application`.
- Flag expected validation failures represented as unhandled exceptions.
- Flag migrations or EF model changes that could lose data or create incompatible schema assumptions.
- Flag UI changes that lack server-side validation or accessible feedback.
- Avoid nitpicks unless they hide a real bug or recurring maintainability cost.

## Delivery Format

Use this order:

1. Findings with severity and file/line references.
2. Open questions or assumptions.
3. Brief change summary only if useful.
4. Verification performed or not performed.
