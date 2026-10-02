---
name: frontend-developer
description: Build, fix, or review frontend UI in this ASP.NET Core MVC project. Use when Codex needs to work on Razor views, layouts, CSS, JavaScript, Bootstrap behavior, accessibility, responsive states, or integration between UI controls and server-rendered data.
---

# Frontend Developer

## Project Baseline

Use this skill for frontend work in `VuiCungWorldCup2026`.

- Treat `Web/` as the presentation layer.
- Expect ASP.NET Core MVC with Razor views in `Web/Views`.
- Expect static assets in `Web/wwwroot`, including Bootstrap, jQuery, validation scripts, `css/site.css`, and `js/site.js`.
- Expect layout-level styling in `Web/Views/Shared/_Layout.cshtml` and `Web/Views/Shared/_Layout.cshtml.css`.
- Respect `agent/coding-rules.md`: keep changes scoped, simple, and directly tied to the request.

## Workflow

1. Inspect the current UI surface before editing:
   - Find relevant views with `rg --files Web/Views`.
   - Read the matching controller action in `Web/Controllers`.
   - Read existing CSS and JavaScript touched by the same page.
2. Preserve MVC conventions:
   - Keep server-rendered concerns in Razor views and view models.
   - Keep behavior in `wwwroot/js` unless the existing view already uses scoped inline behavior.
   - Keep reusable layout or navigation changes in shared views.
3. Implement accessible, responsive UI:
   - Use semantic HTML before adding custom roles.
   - Preserve labels, validation summaries, form helpers, and antiforgery patterns.
   - Use Bootstrap utilities when they fit the existing style.
   - Add custom CSS only when Bootstrap and existing project styles are insufficient.
4. Integrate with backend data carefully:
   - Match property names and nullability from models or view models.
   - Handle empty, loading, and validation states.
   - Keep client-side validation compatible with jQuery validation unobtrusive if forms are involved.
5. Verify the result:
   - Run `dotnet build VuiCungWorldCup2026.slnx`.
   - For UI behavior, run the web app and inspect with Playwright when practical.
   - Check desktop and mobile widths for text overflow and layout overlap.

## Frontend Standards

- Prefer small Razor partials or view components only when repeated UI warrants it.
- Avoid adding frontend frameworks unless the project already uses them for the target feature.
- Keep JavaScript progressive and resilient to missing optional DOM nodes.
- Avoid large visual redesigns when the user asked for a narrow fix.
- Keep copy concise and user-facing text consistent with the rest of the app.
- Do not edit vendored assets under `Web/wwwroot/lib` unless the task is explicitly dependency maintenance.

## Delivery Notes

Summarize changed views, CSS, JavaScript, and any controller/model contracts the UI depends on. Mention browser or viewport checks performed, and call out any UI state that could not be verified locally.
