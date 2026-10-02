---
name: ui-designer
description: Design or refine user-facing interfaces for this ASP.NET Core MVC project. Use when Codex needs visual hierarchy, interaction states, responsive layout, accessibility, Razor view composition, CSS polish, Bootstrap customization, or design-system direction.
---

# UI Designer

## Project Baseline

Use this skill for visual and interaction design work in `VuiCungWorldCup2026`.

- Treat `Web/Views` as the primary UI composition surface.
- Treat `Web/wwwroot/css/site.css` and scoped Razor CSS as the primary custom styling locations.
- Bootstrap is available and should be reused before adding custom component systems.
- The app is World Cup themed by project name; make visual choices that support the product context without adding decorative clutter.
- Respect `agent/coding-rules.md`: keep design changes scoped to the requested UI.

## Design Workflow

1. Audit the existing screen:
   - Read the target Razor view, layout, existing CSS, and related controller model.
   - Identify current spacing, typography, color, component, and interaction patterns.
   - Look for constraints from Bootstrap and MVC validation markup.
2. Set the design direction:
   - Prioritize task clarity and repeated use over marketing-style composition.
   - Use hierarchy, spacing, and alignment before adding decoration.
   - Keep cards for repeated items, forms, modals, or genuinely grouped content.
   - Avoid nested cards and broad page sections styled as floating cards.
3. Design states and responsiveness:
   - Include empty, error, validation, loading, selected, hover, focus, and disabled states when relevant.
   - Ensure text wraps cleanly on mobile and desktop.
   - Use stable dimensions for buttons, lists, counters, and repeated UI blocks.
   - Preserve keyboard and screen-reader usability.
4. Translate design into implementation:
   - Prefer Bootstrap variables/utilities and small custom CSS.
   - Keep color palettes balanced; avoid one-note themes.
   - Use meaningful icons only when an icon improves recognition.
   - Do not add visible instructional text about how the UI was designed.
5. Verify visually:
   - Run the app and inspect with Playwright screenshots when practical.
   - Check at least one mobile and one desktop viewport for overlap, overflow, and awkward wrapping.

## Accessibility Standards

- Maintain WCAG AA contrast for text and controls.
- Keep focus states visible.
- Use semantic landmarks and headings.
- Preserve form labels, validation messages, and accessible names.
- Avoid motion or animation that is necessary to understand content.

## Delivery Notes

Summarize the design intent, changed UI files, and viewport/accessibility checks. Mention any state that still needs real data to validate.
