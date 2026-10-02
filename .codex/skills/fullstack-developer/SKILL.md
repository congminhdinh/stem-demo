---
name: fullstack-developer
description: Build complete product features across the ASP.NET Core MVC stack in this repository. Use when Codex needs to coordinate Domain, Application, Infrastructure, Web controllers, Razor views, validation, persistence boundaries, and end-to-end behavior.
---

# Fullstack Developer

## Project Baseline

Use this skill for changes that span multiple layers in `VuiCungWorldCup2026`.

- `Domain/`: business entities, value objects, domain rules, and domain-facing abstractions.
- `Application/`: use cases, service contracts, DTOs, validation, orchestration, and application logic.
- `Infrastructure/`: persistence, external integrations, repository implementations, and framework adapters.
- `Web/`: ASP.NET Core MVC controllers, Razor views, models, static assets, and app composition.
- `VuiCungWorldCup2026.slnx`: solution build entry point.
- `agent/coding-rules.md`: local guidance for scoped, simple, verified changes.

## Workflow

1. Map the feature path before editing:
   - Identify the user action or endpoint in `Web`.
   - Trace required application services, domain models, and infrastructure dependencies.
   - Confirm whether the repository already has an equivalent pattern to follow.
2. Design the smallest cohesive change:
   - Put business rules in `Domain` or `Application`, not directly in Razor views.
   - Keep controllers thin: bind input, call application logic, choose response/view.
   - Keep infrastructure details behind application or domain abstractions.
   - Add view models when UI shape differs from domain or persistence shape.
3. Implement layer by layer:
   - Start with domain/application contracts and tests when behavior is nontrivial.
   - Add infrastructure implementation only after the contract is clear.
   - Wire services in `Web/Program.cs` using existing dependency injection style.
   - Update controllers and views last so the UI matches actual backend capabilities.
4. Keep cross-layer consistency:
   - Use nullable reference types deliberately.
   - Keep validation messages consistent between server and UI.
   - Normalize error handling and user feedback.
   - Avoid leaking persistence types into Razor views unless that is already the project pattern.
5. Verify the vertical slice:
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run relevant tests if test projects exist or are added.
   - Run the app for user-facing workflows when practical.

## Implementation Standards

- Prefer existing conventions over new architecture.
- Add migrations, seed data, or configuration only when required by the feature.
- Keep feature state and side effects explicit.
- Avoid speculative abstractions or future-proofing.
- Document only decisions that would be hard to infer from the code.

## Delivery Notes

Summarize the changed layers and the end-to-end behavior now supported. Include verification commands and any layer that remains stubbed or unverified.
