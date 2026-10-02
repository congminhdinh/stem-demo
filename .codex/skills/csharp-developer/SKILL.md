---
name: csharp-developer
description: Implement, fix, or review modern C# and .NET code in this repository. Use when Codex needs ASP.NET Core MVC, .NET 10 projects, nullable reference types, dependency injection, async code, clean architecture boundaries, project files, builds, or C# quality improvements.
---

# C# Developer

## Project Baseline

Use this skill for C# and .NET work in `VuiCungWorldCup2026`.

- The solution file is `VuiCungWorldCup2026.slnx`.
- Projects target `net10.0` and enable nullable reference types and implicit usings.
- `Web` is an ASP.NET Core MVC web project.
- `Domain`, `Application`, and `Infrastructure` are class library projects.
- The current codebase is small; avoid adding architecture before the feature needs it.
- Respect `agent/coding-rules.md`: state assumptions when needed, keep edits minimal, and verify.

## Workflow

1. Inspect before editing:
   - Read relevant `.csproj` files before changing packages, target frameworks, or project references.
   - Search existing code with `rg` for naming, namespace, and layering patterns.
   - Read `Web/Program.cs` before changing app startup, middleware, or dependency injection.
2. Write modern C# deliberately:
   - Keep nullable annotations accurate.
   - Prefer clear records or classes based on mutability needs.
   - Use file-scoped namespaces if adding namespaced files and the local style supports it.
   - Use pattern matching and LINQ only where they improve clarity.
   - Keep public APIs small and intention-revealing.
3. Handle async and dependency injection correctly:
   - Use async APIs for I/O.
   - Avoid blocking on tasks with `.Result` or `.Wait()`.
   - Accept abstractions through constructors when behavior must be tested or replaced.
   - Register services in the composition root, normally `Web/Program.cs`.
4. Keep project structure clean:
   - Put domain concepts in `Domain`.
   - Put use-case orchestration in `Application`.
   - Put external adapters in `Infrastructure`.
   - Put MVC concerns in `Web`.
   - Add project references only in the direction required by the architecture.
5. Verify:
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run relevant tests if present.
   - For package or SDK changes, inspect restore/build output for warnings.

## Quality Standards

- Preserve nullable warning cleanliness.
- Prefer simple constructors and explicit dependencies.
- Avoid speculative generic abstractions.
- Keep exceptions meaningful and avoid swallowing errors.
- Avoid changing generated, vendored, `bin`, or `obj` files.
- Keep formatting consistent with the SDK and existing files.

## Delivery Notes

Summarize changed projects, important C# choices, and build/test results. Mention any warnings left behind or tests that do not yet exist.
