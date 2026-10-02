---
name: performance-engineer
description: Measure and improve performance and scalability in this ASP.NET Core MVC solution. Use when Codex needs profiling, load testing strategy, database/query optimization, frontend or backend bottleneck analysis, resource usage reduction, caching, async flow review, or performance regression validation.
---

# Performance Engineer

## Project Baseline

Use this skill for performance work in `VuiCungWorldCup2026`.

- `Web/` performance includes MVC routing, Razor rendering, static assets, model binding, middleware, and request latency.
- `Application/` performance includes service orchestration, filtering, paging, mapping, batching, and validation cost.
- `Infrastructure/` performance includes EF Core queries, indexes, tracking, migrations, connection usage, and identity lookups.
- `Domain/` performance includes scoring rules, value-object operations, and in-memory aggregation.

## Workflow

1. Define the performance target:
   - Identify the user-visible operation, baseline metric, expected load, data size, SLA, and regression threshold.
   - Prefer measured targets over generic "make it faster" goals.
2. Measure before changing:
   - Reproduce latency, throughput, allocation, CPU, memory, query count, or payload size.
   - Use logs, browser tooling, database query output, benchmarks, or targeted instrumentation as appropriate.
   - Document the baseline and the measurement method.
3. Find the bottleneck:
   - Trace request flow across controller, service, domain, and EF query boundaries.
   - Check N+1 queries, missing indexes, broad materialization, unnecessary tracking, repeated mapping, synchronous blocking, large payloads, cache misses, and inefficient algorithms.
   - Separate server latency from browser rendering, network, and database time.
4. Optimize conservatively:
   - Address the measured bottleneck first.
   - Prefer query shaping, indexes, paging, batching, async I/O, and data-structure improvements before adding caches.
   - Add caching only with a clear invalidation and staleness model.
   - Avoid optimizations that obscure business rules without measured benefit.
5. Validate and guard:
   - Re-measure with the same method and compare against baseline.
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - Run tests or browser checks for affected behavior.
   - Consider regression tests, benchmarks, or monitoring hooks for high-risk paths.

## Review Targets

- EF Core: `AsNoTracking`, projection, includes, indexes, filtered queries, pagination, connection usage, and migration impact.
- ASP.NET Core: middleware ordering, dependency lifetimes, async all the way, cancellation tokens, response caching, compression, and static asset caching.
- Application services: repeated repository calls, over-fetching, unnecessary object creation, inefficient mapping, and unbounded lists.
- UI: asset size, layout shifts, repeated DOM work, server-rendered payload size, and slow form workflows.
- Scalability: peak-match traffic, leaderboard calculations, prediction submissions, import jobs, and admin list pages.

## Delivery Notes

Report baseline, bottleneck, change made, measured result, and tradeoffs. If measurement tooling is unavailable, label conclusions as hypotheses and recommend the smallest next measurement.
