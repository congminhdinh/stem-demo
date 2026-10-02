---
name: backend-developer
description: Build, fix, or review server-side behavior in this ASP.NET Core solution. Use when Codex needs to work on controllers, application services, domain rules, infrastructure integrations, dependency injection, validation, security, logging, configuration, or backend performance.
---

# Backend Developer

## Project Baseline

Use this skill for backend-focused changes in `VuiCungWorldCup2026`.

- `Web/` hosts ASP.NET Core MVC entry points, controllers, configuration, and dependency injection.
- `Application/` should hold application services, DTOs, validation, and use-case orchestration.
- `Domain/` should hold business concepts and rules independent of ASP.NET Core.
- `Infrastructure/` should hold framework-specific persistence and external service implementations.
- Target framework is `net10.0` with nullable reference types and implicit usings enabled.
- Respect `agent/coding-rules.md`: keep edits surgical and verify them.

## Workflow

1. Inspect the backend surface:
   - Read `Web/Program.cs` for middleware and service registration.
   - Read target controllers and models under `Web`.
   - Search `Application`, `Domain`, and `Infrastructure` for existing patterns before creating new ones.
2. Place behavior in the right layer:
   - Use controllers for HTTP and MVC concerns only.
   - Use application services for workflows and validation that cross domain objects.
   - Use domain objects for core rules that should not depend on web frameworks.
   - Use infrastructure for persistence, file systems, APIs, and other external dependencies.
3. Implement production-aware behavior:
   - Validate all external input.
   - Prefer typed options for configuration.
   - Use dependency injection instead of manual construction for services.
   - Return appropriate MVC results or HTTP status codes.
   - Avoid exposing secrets, stack traces, or infrastructure details to users.
4. Address reliability and performance:
   - Keep async all the way through I/O paths.
   - Use cancellation tokens when a request-scoped async operation supports them.
   - Avoid repeated expensive work inside request handlers.
   - Add structured logging around important failure paths when logging exists.
5. Verify:
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run or add focused tests for business logic when the change is more than wiring.
   - Exercise changed endpoints or MVC actions when practical.

## Backend Standards

- Do not introduce a database, queue, cache, or external dependency without clear need.
- Keep validation consistent between server behavior and Razor UI feedback.
- Keep exceptions for exceptional cases; use explicit result shapes for expected validation failures when that pattern exists.
- Keep security checks close to the boundary they protect.
- Update appsettings only for real configuration values, never secrets.

## Delivery Notes

Summarize changed backend files, behavior, validation, and verification. Mention any assumptions about storage, auth, or unavailable external services.
