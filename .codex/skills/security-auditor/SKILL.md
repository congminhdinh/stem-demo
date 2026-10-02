---
name: security-auditor
description: Audit security risk, compliance, and controls in this ASP.NET Core MVC solution. Use when Codex needs vulnerability analysis, authentication or authorization review, input validation review, data protection assessment, dependency or configuration review, privacy/compliance gap analysis, or evidence-based remediation recommendations.
---

# Security Auditor

## Project Baseline

Use this skill for security and compliance review in `VuiCungWorldCup2026`.

- `Web/` owns HTTP boundaries, MVC controllers, middleware, cookies, antiforgery, configuration, and user-visible errors.
- `Infrastructure/` owns EF Core persistence, migrations, identity types, and external integration boundaries.
- `Application/` owns request models, service orchestration, validation, filtering, and result contracts.
- `Domain/` should remain framework-independent and enforce core invariants.
- Treat `appsettings*.json`, user secrets, connection strings, auth settings, and logs as security-sensitive.

## Workflow

1. Scope the audit:
   - Identify changed files, exposed endpoints, data handled, actors, privileges, and deployment assumptions.
   - Determine whether the concern is application security, configuration, data privacy, compliance, or operational control.
2. Review boundaries first:
   - Check authentication, authorization, antiforgery, model binding, validation, redirects, uploads, cookies, and error handling.
   - Verify server-side enforcement even when the UI hides an action.
   - Confirm expected failures do not leak stack traces, secrets, connection details, or sensitive object state.
3. Review data protection:
   - Check input validation, output encoding, overposting, mass assignment, SQL/query safety, soft deletion, audit trails, and retention assumptions.
   - Verify sensitive data is not logged, serialized, cached, or exposed in DTOs unnecessarily.
   - Check encryption or hashing requirements before storing credentials, tokens, or private data.
4. Review dependencies and configuration:
   - Inspect package versions, transitive risks when available, and framework security defaults.
   - Verify production configuration is not weakened for development convenience.
   - Check CORS, HTTPS, cookie flags, SameSite, secrets handling, and database permissions where applicable.
5. Report findings:
   - Lead with exploitable issues and concrete impact.
   - Include evidence from files, line references, configs, logs, or commands.
   - Separate confirmed findings from assumptions and hardening suggestions.
   - Recommend small, testable remediation steps.

## Risk Priorities

- Critical: authentication bypass, authorization bypass, remote code execution, SQL injection, secrets exposure, unsafe deserialization, destructive data access.
- High: overposting, missing antiforgery on state changes, sensitive data leakage, weak session/cookie settings, broad admin access, unsafe file handling.
- Medium: inconsistent validation, missing rate limiting on risky flows, insufficient audit logging, stale dependencies, verbose errors.
- Low: hardening gaps, documentation gaps, defense-in-depth improvements.

## Verification

Prefer direct evidence over generic checklists:

- Run `dotnet build VuiCungWorldCup2026.slnx` after security code changes.
- Add or run focused tests for authorization, validation, and data exposure when practical.
- Use browser or HTTP checks for cookies, redirects, forms, and MVC behavior when relevant.
- Document residual risk when external infrastructure, secrets, or deployment settings are not available locally.

## Delivery Notes

Present findings first, ordered by severity, with affected file and line references. Include remediation guidance and any verification performed. Do not claim compliance certification from source review alone.
