# CourseService implementation plan

Plan for building **CourseService**, the service that answers *"what content is there to learn"*. It covers the
service itself, the Admin CMS workflows that author content, the learner-facing read API used by Student Web, and the
integration of the STEM simulator as a lesson activity.

- **Status:** plan only. Nothing here is implemented. **Date:** 2026-10-05.
- **Revision 2 (2026-10-05):** all open PoC decisions are closed (section 14). Content now has two scopes: shared
  platform content (`TenantId = 0`) and tenant-private content (`TenantId > 0`). The simulator change S1 is mandatory
  for the PoC.
- **Audience:** whoever implements CourseService, the Admin CMS and the Student Web course pages.
- **Level of detail:** tasks are outcome-based (goal, scope, technology, proof). Class, DTO, route and property names
  are left to the implementer unless a name is needed to explain a boundary.
- Coding rules: [`coding-rules.md`](coding-rules.md). Current backend: [`architecture.md`](architecture.md).
  OpenSTEM research: [`openstem-learning-experience-research.md`](openstem-learning-experience-research.md).

## 1. Sources and evidence labels

Sources read for this plan:

| Source | What it gave this plan |
| --- | --- |
| `docs/openstem-learning-experience-research.md` | How OpenSTEM structures and plays a course **for a learner** |
| `docs/architecture.md`, `docs/coding-rules.md` | Service conventions, multi-tenancy, auth, database model, simplicity rules |
| `Infrastructure/`, `Services/AccountService`, `Services/TenantService`, `STEMLearning.AppHost` | What the shared code actually does today: entities, tenancy provider and interceptor, auth, token claims, tenant seeding, SuperAdmin checks |
| `C:\Users\MINH.DC\source\repos\stem-demo` (README, `docs/`, `src/main.tsx`, `src/ui/app/App.tsx`, `src/core/circuit/document.ts`, `src/core/persistence/project-repository.ts`, `vite.config.ts`) | What the STEM simulator can do today and how it starts |

Every statement that is not obvious carries one of these labels:

- **Observed**: OpenSTEM behaviour recorded in the research note.
- **Inferred**: a conclusion the research note draws but does not prove.
- **Repo**: a fact read from the STEMLearning or stem-demo source and docs on 2026-10-05.
- **Decision**: our choice for the PoC, made in this plan. It is not OpenSTEM behaviour. All decisions are listed in section 14.
- **Deferred**: a question that does not block the PoC. It is answered when the first feature that needs it is planned.

**The research did not examine OpenSTEM's authoring/CMS** (research note, *Scope*: "Not examined: course
authoring/CMS"). Everything about the Admin CMS in this plan is designed from STEMLearning's own product needs.
Nothing in it describes how OpenSTEM authors content. The same holds for shared versus tenant-private content: whether
OpenSTEM's organization catalog holds platform-provided or organization-authored courses is not established by the
research, so the scope model in section 7 is our own decision.

## 2. What exists today (relevant facts)

From STEMLearning (**Repo**):

- Each service is one ASP.NET Core Minimal API project under `Services/`, referencing only `Infrastructure`, with its
  own DbContext and migrations in the shared physical database `stemlearningdb`.
- `Infrastructure` entities: `BaseEntity` (`int Id`) → `AuditableEntity` (audit fields, `IsDeleted`) → `TenancyEntity`
  (`TenantId`). Deletes of auditable entities become **soft deletes**, and a global filter hides them.
- Tenant comes from the JWT `Tenant` claim. Read filtering is **explicit** through `TenancySpecification<T>`
  (`TenantId == x`); there is no global tenant filter.
- **In `Infrastructure`, `0` means "no tenant":**
  - `CurrentTenantProvider` returns the token's tenant only when it is greater than 0;
  - `UpdateTenancyInterceptor` treats an entity whose `TenantId` is `0` as "not set yet" and overwrites it with the
    caller's tenant on save.
- Tenant ids come from an identity column (`IdentityByDefaultColumn` in TenantService's `AddTenant` migration), which
  starts at 1. The SuperAdmin tenant `Id = 1` is seeded with `HasData`. **No tenant with `Id = 0` exists.**
- Tenant-key validation returns the id of an active tenant with that key, or `-1`. Login rejects only `-1`.
- AccountService issues tokens with `Scope = web` only. The `admin` scope policy (`MapAdminApiGroup`) is therefore not
  satisfied by any token today. Admin-only endpoints in AccountService use the `web-api` group plus an `IsAdmin` check
  in the business class.
- Roles today:
  - SuperAdmin: `IsAdmin` in tenant `1`, checked as `Tenant == 1 && IsAdmin` in TenantService and AccountService;
  - tenant admin: `IsAdmin` in its own tenant;
  - other accounts.

  The only account type is `Student` (`Type = 0`). `Permissions` is stored but not enforced.
- A cookie scheme named `STEMLearning` is registered but unused, and `ICurrentUserProvider` can read the token from an
  `AccessToken` claim "for MVC views". This is the AIChat2025 pattern for a server-rendered admin site.
- Errors are returned as `BaseResponse` with `Status = Error` and HTTP 200.
- Not in place: API gateway, message broker, frontends, automated tests.

Consequence: using `TenantId = 0` for shared content (section 7) is new. It collides with the "0 = not set" convention,
so section 7.4 and task T0 handle it explicitly.

From stem-demo, the STEM simulator (**Repo**):

- "STEM Studio": a browser-only React 19 + Vite app with a Konva circuit canvas, a Blockly program editor, a
  runtime (`RunSession`) and simulated devices (board, LED, resistor, push button). No backend.
- Its unit of work is a **project document** (`schemaVersion: 1`, `id`, `name`, `circuit`, `program.blocks` as
  Blockly JSON).
- At startup it opens **the last project saved in IndexedDB** (database `stem-studio`), or the bundled **Blink**
  sample when nothing is saved. Other bundled samples (`led-on`, `button-direct`, `button-led`) can only be loaded
  through a development-only console hook.
- It reads **no URL parameters** and uses **no `postMessage`** (no `location`, `searchParams`, `postMessage` or
  `window.parent` usage in the non-test files of `src/`).
- The dev server runs on port 5173 and sets COOP/COEP headers, which its own plan marks as optional.
- Its plan lists LMS, CMS and backend as non-goals.

Consequence: **today the simulator cannot be told which lab to open.** Embedded in a lesson, every StemLab activity
would show the same "last project". Section 9.2 makes the fix (S1) a mandatory part of the PoC.

## 3. Service boundary

```text
Admin CMS (ASP.NET Core MVC)                          Student Web (React)
  tenant admin  → manages its tenant's private courses   read published shared courses (TenantId 0)
  SuperAdmin    → manages shared courses (TenantId 0)    + published courses of the learner's own tenant
      │                                                     │
      ▼                                                     ▼
┌──────────────────────────────── CourseService ────────────────────────────────┐
│  Course ─► Module ─► Lesson ─► Activity  (definitions, order, status, scope)   │
│  references only: TenantId, MediaId/URL, AssessmentId, simulator keys          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| CourseService owns | CourseService does not own (owner) |
| --- | --- |
| Course, Module, Lesson and Activity definitions | Accounts, login, roles (AccountService) |
| Content scope (shared or tenant-private) and its rules | Tenant definition, tenant keys, the platform tenant record (TenantService) |
| Ordering at every level | Enrollment, progress, completion, resume, XP (LearningService) |
| Content lifecycle (Draft / Published) and learner visibility | Questions, answers, attempts, grading (AssessmentService) |
| Per-type activity settings and their validation | File bytes, upload, storage lifecycle (MediaService) |
| References to media, assessments and simulator labs | Simulator runtime state, circuits, Blockly programs, a learner's lab work (STEM simulator; long-term owner deferred, D-17) |

Rules carried over from the architecture (**Repo**, unchanged):

- no project reference to another service; no use of another service's DbContext or tables; no shared entities;
- other services' data is referenced by id only (`TenantId`, `AssessmentId`, `MediaId`). These are values, not
  database foreign keys;
- integration goes through HTTP contracts, and later events, only when a real need appears.

**Decision (D-19):** in the PoC, CourseService makes **no outgoing calls** to other services. Tenant and role come
from the token, and references are stored without being resolved.

## 4. Conceptual content model

```text
Course        scope: Shared (TenantId = 0) or TenantPrivate (TenantId = N > 0); metadata; lifecycle status
 └── Module   ordered within the course; same scope as its course
      └── Lesson     ordered within the module; kind (presentation hint); same scope
           └── Activity   ordered within the lesson; stable id; type; type-specific settings; same scope
```

How this relates to OpenSTEM:

- **Observed:** OpenSTEM's hierarchy is Path → Course → Section ("mục") → Lesson → Slide → Block, ordered at every
  level. Activity slides usually hold one interactive block plus optional supporting text or image.
- **Inferred:** lesson content is a data document rendered by a generic player (the player loads one JSON file per
  course and one per lesson, which is **Observed**).
- **Decision:** keep **Course → Module → Lesson → Activity**, with no Slide level and no Learning Path. One Activity is
  one screen in the Student Web player. An activity carries its own supporting text when it needs it, so a separate
  Slide entity is unnecessary for the PoC. Learning paths are a many-to-many grouping over courses (**Inferred** from the
  same course appearing in two paths) and can be added later without changing courses.
- **Decision:** the scope belongs to the course and is inherited by everything under it (section 7.1).

### 4.1 Questions about the model

| Question | Answer |
| --- | --- |
| Is Module needed in the PoC? | **Decision (D-1): yes, and mandatory.** Every lesson belongs to a module. OpenSTEM groups lessons into sections (**Observed**), and the Student Web table of contents needs the grouping. A short course has one module. Making the level optional would create two code paths in the CMS, the API and the player |
| Does a lesson have one activity or many? | **Decision (D-2): many, ordered.** **Observed:** one OpenSTEM lesson mixed text, video, a poll, ordering, classification, quizzes and a rubric |
| Are activity settings relational or JSONB? | **Decision (D-3): both.** Identity, parent, order, type, title, tenant and audit fields are relational columns. Type-specific settings are one JSONB document per activity, validated by CourseService for that type. Adding a type then needs no migration. This matches the research recommendation and OpenSTEM's per-lesson JSON documents (**Observed**) |

### 4.2 Fields (conceptual, PoC)

Only fields that the PoC demo or the learner UI needs. Names are indicative.

| Level | PoC fields | Evidence |
| --- | --- | --- |
| Course | scope (`TenantId`), title, short summary, description (Markdown), cover image reference, learning objectives (ordered list), category, level, age range, status, published at | **Observed** in the OpenSTEM course info page, except scope (**Decision**). Module and lesson counts are **derived**, not stored. Category, level and age range are free text in the PoC; a taxonomy comes later |
| Module | title, optional description, order | **Observed:** sections have a title only |
| Lesson | title, optional summary, kind (`Reading` / `Lab`, a presentation hint for the icon and layout), optional reference label (for example a textbook page), order | **Observed:** lesson kind changes the layout; lessons show a textbook tag |
| Activity | title, type, order, settings (JSONB) | **Observed:** blocks are typed; progress is keyed by block id |

Every Module, Lesson and Activity row also stores its course's `TenantId` for direct filtering (section 7.1).

Deferred: XP values (gamification rules are not settled between CourseService and LearningService), duration,
prerequisites (**Observed** as not shown in the learner UI), slugs.

### 4.3 Identity and ordering

- **Observed:** OpenSTEM records completion **per block id**, and its lesson state carries a `contentId`.
  Progress therefore depends on content identity staying stable.
- **Decision:** every Course, Module, Lesson and Activity has a stable id that never changes on edit, reorder or
  move, and is never reused. Editing updates the row in place. The CMS never "saves a lesson" by deleting and
  recreating its activities.
- **Decision:** order is a position among siblings. A reorder submits the complete ordered list of sibling ids, and the
  service rejects a list that does not match the current siblings (a stale or concurrent edit).
- **Decision (D-11): ids are `int`**, from `Infrastructure`'s `BaseEntity`, like the other services. PostgreSQL
  identity values are not reused, which satisfies stability. GUIDs or a logical content id separate from the row id are
  reconsidered only when one of these arrives: import/export, course cloning, cross-environment content sync, content
  versioning.

## 5. Activity model

Each activity type defines: its settings and their validation (CourseService), how it renders (Student Web and the CMS
preview), and its **completion mode**, which CourseService declares and LearningService evaluates later.

| Type | Settings (conceptual) | Completion mode (declared) | PoC |
| --- | --- | --- | --- |
| `RichText` | Markdown body; images by URL inside it | `OnView` | **Yes** |
| `Video` | video reference (direct file URL in the PoC), optional poster image reference | `OnMediaEnd` (**Observed:** OpenSTEM completes video at its end) | **Yes** |
| `StemLab` | simulator key, template key, launch options (opaque, reserved), instructions (Markdown) | `OnView` until the simulator reports events (section 9) | **Yes** |
| `Assessment` | `AssessmentId`, optional intro text | owned by AssessmentService's result; see below | No: type and boundary defined now, enabled with AssessmentService |

- **Decision (D-18):** in the PoC the completion mode is **derived from the type** and exposed read-only. It is not
  editable in the CMS. An author-set "optional / required" flag comes later.
- **Decision:** settings are validated on every write (required fields, URL scheme `http`/`https`, size limits). An
  activity with invalid settings is never stored, so publish does not need to re-validate settings.
- **Decision (D-15):** Markdown is rendered with raw HTML disabled, in Student Web and in the CMS preview.
  OpenSTEM rich text being Markdown is only **Inferred** (from a `md` class name); we choose Markdown on its own merits:
  simple to author in a textarea and safe to render.

### 5.1 Quiz and the Assessment boundary

**Observed:** OpenSTEM places quizzes, polls, ordering and rubrics inside lessons as blocks, and a wrong quiz answer
still completes the block.

**Decision (D-20, boundary):**

- CourseService does **not** store questions, options, answer keys, explanations or scoring, even temporarily.
  Storing them "for now" would mean migrating data out later.
- An `Assessment` activity stores only a reference (`AssessmentId`) plus presentation text. AssessmentService owns the
  definition, the attempts and the grading. Student Web loads the assessment from AssessmentService by that id.
- **Completed** (LearningService) and **graded correct** (AssessmentService) stay separate.
- The CMS will pick an assessment from AssessmentService's list. CourseService stores the id without resolving it.
  A dangling reference (the assessment was deleted) is shown by Student Web as "unavailable".
- A shared course may reference only platform-scope assessments (section 12).
- The PoC demo does not include a quiz, so the `Assessment` type is not enabled this week.

**Deferred (D-10):** do **ungraded** inline interactions (prediction poll, reflection) belong to CourseService as content,
or to AssessmentService? This is decided when the first such feature is planned. It does not block the PoC. The
boundary that stays fixed: anything with an answer key, a score or grading belongs to AssessmentService.

### 5.2 Later activity types

Seen in OpenSTEM (**Observed**) and not in the PoC: `Poll`, `Ordering`, `Classification`, `DataTable`, `Rubric`,
`ClassVote` (teacher-led), and multi-block slide layouts. Each one is a new type with settings, a renderer and a
completion mode; graded ones go through AssessmentService.

## 6. Content lifecycle

### 6.1 States and visibility

- **Decision (D-4):** lifecycle lives at **course level only**: `Draft` ⇄ `Published`. There is no module-level or
  lesson-level publish in the PoC.
  - `Draft`: visible only in the CMS, to whoever manages that scope.
  - `Published`: visible through the learner API to every authenticated account of the owning tenant. For a shared
    course (`TenantId = 0`), that means every account of every tenant.
  - **Unpublish** returns a course to `Draft`. Learners lose access immediately; LearningService progress is untouched.
    Unpublishing a shared course removes it for all tenants at once.
- **Decision (D-4), edits while published:** changes to modules, lessons and activities of a published course take
  effect for learners **immediately**.
  - The CMS shows a clear "this course is live" warning on every edit screen of a published course. For a shared course
    the warning says the change reaches learners of all tenants.
  - Authors should unpublish before large changes.
  - A published snapshot or versioning is Later.
- **Decision:** learner visibility also hides empty containers: a lesson with no activities and a module with no
  visible lessons are left out of the learner view.
- **Decision:** publish validation (PoC): the course has a title and at least one lesson with at least one activity.
  Activity settings are already valid (section 5).
- `Archived` (retire a course but keep it readable for learners who took it) is **Later**.

### 6.2 Delete

- **Decision (D-5):** delete is **soft**, which `Infrastructure` already does for every `AuditableEntity`. Deleting a
  container soft-deletes its whole subtree, so a direct lookup by a child id also returns "not found".
- **Decision (D-5):** a course can be deleted only while it is `Draft` (unpublish first). Modules, lessons and
  activities can be deleted in any state. In a published course the CMS confirmation says that students may have
  progress on that content and that it will disappear from their course. The same rules apply to shared courses,
  where only the SuperAdmin can delete.
- Restore of deleted content is **Later**. Soft-deleted rows stay in the database, so restoring is possible later.

### 6.3 Content changes versus learner progress

LearningService does not exist yet, but its correctness depends on CourseService identity rules. The PoC does not
solve versioning; it makes the behaviour predictable. **Decision (D-6):** these rules apply in the PoC, and
LearningService implements them when it is built.

| Change | Effect on progress (rule) |
| --- | --- |
| Reorder modules, lessons or activities | None. Progress is keyed by id, never by position |
| Edit an activity (same id): text, title, video URL, template | None. Progress is not reset. If the meaning changed, old progress may be stale; this is **accepted in the PoC** |
| Add an activity to a lesson a learner already completed | The lesson **stays Completed**. It does not go back to InProgress, and completion is not revoked |
| Delete an activity or lesson | The id disappears from the published outline. LearningService must tolerate unknown ids and leave them out of roll-up, so a course percentage can change |
| Unpublish | Content becomes unavailable; progress is kept |

Revision- or version-aware progress (for example a per-activity revision that LearningService compares) is **Later**.

## 7. Multi-tenancy, content scope and authorization

### 7.1 Content scope

**Decision (D-13):** CourseService supports **shared platform content and tenant-private content** from the start.

```text
ContentScope
  Shared         root Course.TenantId = 0      platform-owned; when Published, readable by every valid tenant
  TenantPrivate  root Course.TenantId = N > 0  owned by tenant N; read and managed only within tenant N

Example
  Course A   TenantId = 0   shared course for the whole platform
  Course B   TenantId = 5   private course of tenant 5 only
```

- Shared and private courses are **independent course records**. A shared and a private course with the same title or
  metadata are two different courses. There is no deduplication, override or "tenant copy" of a shared course in the
  PoC.
- **Invariant: descendants inherit the Course tenant scope.** Every Module, Lesson and Activity stores the same
  `TenantId` as its course, for fast filtering. A mix such as "Course `TenantId = 5`, Module `TenantId = 0`", or the
  reverse, must be impossible:
  - a child's `TenantId` is copied from its parent course when the child is created;
  - it is never taken from a request body or query;
  - moving content between courses is not in the PoC; when added, it must keep the invariant.
- **Decision:** in the PoC, every published shared course is visible to every tenant. Choosing which tenants get which
  shared course (assignment, licensing, a tenant hiding a shared course) is Later.

### 7.2 The platform tenant, `Id = 0`

**Decision (D-23):** tenant `Id = 0` is **reserved** for the platform/shared scope.

- **Name:** conceptually the Platform / Shared / System tenant. The business name is not fixed yet.
- **Never a normal tenant:** `0` is never assigned to one.
- **Has a record in TenantService:** this makes the reservation visible and enforceable. CourseService does not need
  the record at runtime: it has no foreign key and makes no calls, and treats `0` as the constant "shared" scope.
- **Not a login tenant:** it has no tenant key and no accounts, and nobody can obtain a token with `Tenant = 0`.
- **SuperAdmin is unchanged.** SuperAdmin stays tenant `1` (`Tenant == 1 && IsAdmin`). Tenant `0` is not the SuperAdmin
  tenant, and this plan does **not** move SuperAdmin to tenant `0`. Any such change needs its own requirement.
- **Work:** creating and protecting the record is an implementation task in TenantService/AccountService (**T0**,
  section 15). This planning task changes no code.

### 7.3 Who can do what

**Decision (D-24):** the management scope is decided by the caller's role in the token, not by a choice in the request.

| Caller (from the token) | Management (CMS) | Learner read |
| --- | --- | --- |
| Tenant admin of tenant N (`IsAdmin`, `Tenant = N`, N ≠ 1) | Private courses with `TenantId = N`: create, edit, reorder, publish, unpublish, delete | Published courses with `TenantId = N` or `0` |
| SuperAdmin (`IsAdmin`, `Tenant = 1`) | Shared courses with `TenantId = 0`: create, edit, reorder, publish, unpublish, delete | Published courses with `TenantId = 1` or `0` |
| Other account of tenant N | None | Published courses with `TenantId = N` or `0` |
| Token without a usable tenant (`Tenant` claim missing or `0`) | Rejected | Rejected |

- A tenant admin **cannot** create, update, delete, reorder, publish or unpublish shared content. Shared courses never
  appear in its management results, and a management call on a shared id returns "not found". Read-only display of
  published shared courses in its CMS, if wanted, uses the learner read API (section 8.1).
- In the PoC the SuperAdmin manages **shared content only**. Managing a tenant's private courses would need a "target
  tenant" choice that the current model does not have; it is Later. Private courses of tenant `1` are not a use case.
- Endpoints use the `web-api` group with the role checks in the business layer, the same way as AccountService. They do
  not use `MapAdminApiGroup`, because no token carries the `admin` scope (**Repo**).
- Learner endpoints require any authenticated account. Enrollment is not checked: who is enrolled belongs to
  LearningService.

### 7.4 Filtering and scope enforcement

**Decision (D-25):**

```text
Management query
  tenant admin of N   TenantId = N    and not deleted
  SuperAdmin          TenantId = 0    and not deleted

Learner query
  (TenantId = callerTenant OR TenantId = 0) and course Published and not deleted
  applied to the course and to every module, lesson or activity looked up by id
```

- **Tenant and role come only from the token.** They are never taken from a request body or query, and CourseService
  does not call TenantService on requests.
- **One "not found" for all hidden cases.** Another tenant's content, a draft course in the learner API, deleted content
  and a shared id in a tenant admin's management call all return the same response. A caller cannot tell whether an id
  exists.
- **Shared scope comes only from the SuperAdmin check.** CourseService never infers it from a caller tenant of `0`.
  `0` means "no tenant" in `Infrastructure`, so such a request is rejected.
- **CourseService sets the scope itself, not `UpdateTenancyInterceptor`.**
  - The interceptor treats `TenantId = 0` as "not set" (**Repo**). It would rewrite a SuperAdmin's new shared course to
    tenant `1`.
  - So content rows carry `TenantId` but are not stamped by the interceptor (for example, they are not modelled as
    `TenancyEntity`). CourseService assigns the course scope from the role and copies it to children from the parent.
  - The equality filter of `TenancySpecification<T>` still fits management queries. The learner query needs
    CourseService's own "own tenant or shared" filter.
  - `Infrastructure`'s "0 = not set" convention stays unchanged for the other services.

### 7.5 Later

- A dedicated content-author role instead of "tenant admin", and enforcement of `Permissions`.
- SuperAdmin managing tenant-private courses.
- Per-tenant assignment or licensing of shared courses.
- Copying a shared course into a tenant as a private course: this is cloning, with new ids.

## 8. Admin CMS scope

Designed from STEMLearning's needs. No OpenSTEM evidence is involved (section 1).

### 8.1 Workflows the CMS must support in the PoC

One CMS application serves both scopes. The scope follows from who signs in (section 7.3); it is not a choice in the UI.

| CMS user | Signs in with | Works on |
| --- | --- | --- |
| Tenant admin | its tenant key, email, password | private courses of its own tenant |
| SuperAdmin | the SuperAdmin tenant key, email, password | shared courses (`TenantId = 0`) |

| Area | Workflows |
| --- | --- |
| Sign-in | Sign in through AccountService; only `IsAdmin` accounts may continue; the CMS shows which scope the user manages ("Shared platform content" or the tenant) |
| Course list | List the courses of the user's management scope with title, status and last update; filter by status; create a course in that scope |
| Course | Create (lands in `Draft`); edit metadata; publish (shows validation problems if it fails); unpublish (with confirmation); delete (Draft only, with confirmation); see the outline (modules → lessons) on one page |
| Module | Create; edit title/description; delete (confirmation states how many lessons and activities go with it); reorder within the course |
| Lesson | Create in a module; edit title, kind, summary, reference label; delete; reorder within the module |
| Activity | See a lesson's ordered activities; add one by choosing a type; edit it through the form of that type; delete; reorder within the lesson |
| Activity forms | `RichText`: Markdown textarea with a rendered preview. `Video`: URL and poster URL with an inline player preview. `StemLab`: template picker, instructions, and a live simulator preview (section 9.3) |
| Feedback | Show service validation errors on the form; show the "live course" warning on every edit screen of a published course, stating "all tenants" for a shared course |
| Shared courses seen by a tenant admin | Not required for the PoC. If shown, a read-only list of published shared courses taken from the learner read API, with no edit actions |

### 8.2 Not in the PoC CMS

WYSIWYG editor, drag-and-drop ordering, media upload, moving lessons or activities between parents, duplicate or clone,
bulk operations, revisions and approval workflow, edit locking for concurrent authors (last write wins in the PoC),
audit history view, full-lesson draft preview, SuperAdmin editing of tenant-private courses. Authors check the learner
view in Student Web after publishing.

### 8.3 Where the CMS lives

**Decision (D-12):** a **separate ASP.NET Core MVC/Razor project**. Razor pages are not embedded in CourseService.

- It owns no course database and no content rules; CourseService validates everything.
- It signs in through AccountService and keeps the user's JWT in the existing `STEMLearning` cookie scheme (the
  `AccessToken` claim pattern already supported by `Infrastructure`). It calls the CourseService management API with
  that token.
- Its authorization is the current flow: tenant key login, `IsAdmin`, and the SuperAdmin check described in
  section 7.3.
- It can later host screens for other services (accounts, assessments, media).
- It lives outside `Services/`, in a solution folder for non-service apps (for example `Web/`), named when the project
  is created.

## 9. STEM simulator integration

Section 2 lists what the simulator does today (**Repo**). This section is our own design. The only OpenSTEM input is
**Observed** learner-side behaviour: InnoLab is a separate app in an `<iframe>`, the experiment is chosen by a query
parameter (`?experiment=velocity`), numbered guide steps sit beside it, it stays mounted across related slides, and
running it did not change completion. Whether InnoLab reports results to the player is not established.

### 9.1 What CourseService stores for a `StemLab` activity

```text
StemLab activity definition (conceptual)
  simulator key     which simulator app (PoC: one value, the STEM Studio app)
  template key      which lab/template the simulator opens (owned and defined by the simulator)
  launch options    opaque key/values passed through to the simulator (reserved; empty in the PoC)
  instructions      Markdown guide shown beside the lab (numbered steps and images are plain Markdown in the PoC)
  completion mode   OnView in the PoC
```

- **Decision (D-7):** CourseService stores **keys, not URLs and not simulator documents**. The simulator's base URL is
  environment configuration given to Student Web and the CMS. Reasons:
  - content does not change when the simulator moves between environments;
  - an author cannot embed an arbitrary site in an iframe;
  - CourseService never learns the project-document format, Blockly JSON, Konva, `RunSession` or any runtime state.
- **Decision:** the template is **owned by the simulator**. CourseService does not validate that a template key exists,
  because that would need knowledge of simulator internals. The CMS offers only configured keys (section 9.3), and a bad
  key surfaces in the CMS preview.
- Shared and private courses use StemLab the same way; the scope does not change the activity definition.
- Rejected for the PoC: storing a full project document in CourseService as the initial state. It would couple
  CourseService to the simulator's schema versions. If authored, per-course templates are needed later, they belong to
  a simulator-side template catalog (or MediaService as an opaque file) that CourseService references by key.

### 9.2 S1 — simulator embed launch (mandatory this week)

**Decision (D-21): S1 is no longer optional for the planned PoC. It must land this week.** It is done in the
`stem-demo` repository, under that project's own plan, as a task running in parallel with the CourseService tasks.
It is not CourseService work, and this planning task does not change stem-demo.

The simulator must support at least:

1. **Embed mode:** a way to start the app as an embedded lab, distinct from the standalone editor.
2. **Select a template at launch**, for example through a query parameter, and open that template instead of "the last
   project". PoC template keys: `blink`, `led-on`, `button-direct`, `button-led`, `empty`. The first four are the
   bundled samples; `empty` is the app's existing new project.
3. **No unrelated "last project" in embed mode.** Inside Student Web all labs share one storage partition, because
   browsers partition a cross-origin iframe's storage by the embedding site. In embed mode the simulator must not
   restore, or overwrite, the standalone "last project". Otherwise one lesson's circuit leaks into another lesson or
   template. Keeping nothing (D-17) satisfies this.
4. **Iframe compatibility:** it can be framed by the Student Web and CMS origins. Check that its COOP/COEP headers do
   not block embedding; its plan already allows removing them.

**Success criterion for T7 and T9:** a `StemLab` activity opens **the correct configured template**. For example, a
`blink` activity shows the Blink project and a `button-led` activity shows the Button LED project.

S1 must be complete before T7 and T9 can pass. An emergency fallback exists only in the risk table (section 17), and
using it means the PoC criterion is **not** met.

### 9.3 CMS needs

- Create, edit, delete and reorder a `StemLab` activity like any other activity.
- **Decision (D-9): choose a template from a static list** (key and title) in the CMS configuration: `blink`, `led-on`,
  `button-direct`, `button-led`, `empty`. There is no simulator catalog API this week; a template manifest or catalog
  API is Later.
- **Decision (D-8): preview is an iframe on the StemLab authoring form.** It uses the same launch contract and the same
  launch URL rule as Student Web, so the preview shows what learners will see. Full-lesson draft preview is Later.

### 9.4 Student Web needs

- Receive the activity definition from the learner API and build the launch URL: configured base URL for the simulator
  key, plus embed mode, the template key and launch options.
- Render the instructions beside or above an `<iframe>` with an explicit `allow` list (no hardware permissions: this
  simulator uses none) and a `sandbox` that keeps scripts and the simulator's own storage working. Verify both.
- Show a clear error state when the simulator is unreachable.
- Completion is `OnView` in the PoC. Run events are Later.

### 9.5 Learner lab work

**Decision (D-17), PoC:** a learner's lab work is **not saved on the server**. In embed mode the simulator never
restores a global "last project" (S1, point 3). Which service owns saved lab work long term (LearningService, as an
activity response, or a future STEM/project service) is **Deferred**. It is never CourseService, and it does not block
CourseService.

### 9.6 Later

- An origin-checked `postMessage` contract (`ready`, `runStarted`, `runCompleted`, measurements) and a completion mode
  driven by it, evaluated by LearningService.
- Keep the lab mounted across the following activities that use it (**Observed** in OpenSTEM). This needs a way for an
  activity to point at an earlier `StemLab` activity.
- Server-side storage of lab work (D-17).
- A simulator template manifest or catalog API to replace the static CMS list.
- Content Security Policy `frame-src` for simulator origins.

## 10. Learner-facing scope

The read flow Student Web needs, and what each service answers:

```text
Student Web                       CourseService (definition)                 LearningService (later, state)
course catalog          ───────►  published shared courses (TenantId 0)      enrolled? progress %?
                                  + published courses of the caller's tenant
course page             ───────►  course metadata + outline                  completed lessons? resume where?
                                  (modules → lessons, ids, order, kind)
open lesson             ───────►  lesson + ordered activities                which activities are done?
                                  (type, settings, completion mode)
render each activity              (Student Web renderer per type)            report completion (later)
previous / next lesson  ───────►  previous/next lesson ids in course order
```

- **Decision (D-13), learner visibility:** a learner of tenant N sees published courses with `TenantId = N` **or**
  `TenantId = 0`, and never those of another tenant. Drafts of either scope are never visible.
  Example: a learner of tenant 7 sees the shared published courses plus tenant 7's published courses. It does not see
  courses of tenants 5 or 6.
- Each catalog entry carries its scope, so Student Web can label platform courses if it wants. No grouping, ordering or
  deduplication between shared and private courses is required.
- **Decision:** CourseService answers only the left column: definitions, order, presentation metadata. It returns
  nothing about the caller's state ("completed", "resume here", "current lesson").
- Student Web joins definition and state **on the client** by stable ids, once LearningService exists.
- The lesson response carries its course and module ids and the previous/next lesson ids, so a deep link to a lesson
  works without loading the outline first. The visibility rule above applies to every lookup by id.
- The learner shape is a **separate projection** from the management shape, so author-only fields added later do not
  leak to learners.
- **Observed:** OpenSTEM does not gate navigation in practice. **Decision:** CourseService does not gate either.
  Gating, if ever added, is a LearningService rule.

## 11. Media

- **Observed:** OpenSTEM serves images from a shared course-assets folder and video as self-hosted `.mp4` in a native
  `<video>` element.
- **Decision:** CourseService holds **media references only**: cover image, lesson image, video, poster, and images
  inside Markdown. It never receives, stores or serves file bytes.
- **PoC simplification:** references are plain `http(s)` URLs to static files (for example sample media served by
  Student Web or another static host). The CMS form takes a URL; there is no upload. Media used by a shared course must
  be reachable by learners of every tenant.
- **Later:** MediaService owns upload, storage, variants and lifecycle. A reference then carries a `MediaId`, which
  Student Web resolves to a URL. Design the reference fields so they can hold either form, without migrating the content
  model's shape. MediaService will need a platform scope too, so that shared courses reference only media readable by
  every tenant. Video from external providers (YouTube and others), captions and transcripts are Later too.

## 12. Integration contracts

| With | PoC | Later |
| --- | --- | --- |
| AccountService | No calls. CourseService trusts the JWT: `Tenant`, `IsAdmin`, the SuperAdmin rule `Tenant == 1 && IsAdmin`, user id for audit fields | Content-author role |
| TenantService | No calls; tenant isolation uses the token only. Prerequisite **T0** reserves the platform tenant `Id = 0` | Tenant deactivation hiding content, if required; per-tenant assignment of shared courses |
| LearningService | Contract prepared, not built: stable ids; a published outline with ordered lessons, activity ids and completion modes that LearningService can read over HTTP; the progress rules of D-6 (section 6.3). A learner's progress on a shared course belongs to the learner's tenant and references content ids whose `TenantId` is `0` | Content-change notifications (events once a broker exists) or revision numbers |
| AssessmentService | Boundary defined (section 5.1); type not enabled | `Assessment` activity enabled; CMS picker; shared courses reference only platform-scope assessments |
| MediaService | URLs only | `MediaId` references; platform-scope media for shared courses |
| STEM simulator | Keys plus the S1 embed launch contract (section 9.2) | `postMessage` events; template catalog |

## 13. Technology choices

| Area | Choice | Notes |
| --- | --- | --- |
| Service | .NET 10, ASP.NET Core Minimal API, shared `Infrastructure` | Same bootstrap, folder convention and per-service Swagger as the existing services |
| Data | PostgreSQL in `stemlearningdb`, EF Core 10 + Npgsql, migrations owned by CourseService | Relational tables for the hierarchy, order, status and `TenantId` scope; **JSONB** for activity settings; small ordered value lists such as objectives stored on the course row |
| Schema | **Decision (D-14):** the `CourseService` schema holds CourseService's entity tables **and** its migration history | Names like "Modules" and "Activities" are generic and could collide in the shared database. `architecture.md` allows a service to map its tables out of `public`; record the choice there |
| Scope handling | CourseService assigns `TenantId` itself (D-25), not `UpdateTenancyInterceptor` | Keeps `Infrastructure` unchanged for the other services |
| Orchestration | Aspire AppHost: CourseService (`CourseDbContext`, `JwtSecretKey`, `/health`), the CMS, Student Web; the simulator URL as a parameter | The simulator can keep running from its own repo; give Student Web a port other than 5173, which the simulator uses |
| Admin CMS | **Decision (D-12):** separate ASP.NET Core MVC / Razor project; server-rendered forms, one partial form per activity type, Markdown in a textarea | No front-end framework needed for the PoC |
| Student Web | React + TypeScript + Vite; one renderer per activity type; Markdown renderer with raw HTML off; native `<video>`; `<iframe>` for StemLab | **Decision (D-16):** reaches the services through the **Vite dev-server proxy** in the PoC. No API gateway and no production CORS design this week |
| STEM simulator | Independent React/Vite app embedded by iframe | Changed only through its own plan (S1, section 9.2) |
| Verification | **Decision (D-22):** repeatable `.http` scenarios for the PoC | Automated integration tests are Later; the repository has none yet |

## 14. Decisions

### 14.1 Decided for the PoC

| Id | Decision | Section |
| --- | --- | --- |
| D-1 | Module is a mandatory level | 4.1 |
| D-2 | A lesson has many ordered activities; one activity is one player screen; no Slide level | 4.1 |
| D-3 | Relational hierarchy plus JSONB settings validated per type | 4.1 |
| D-4 | Draft/Published at course level only; edits to a published course are live, with a CMS warning; unpublish before large changes; snapshots and versioning Later | 6.1 |
| D-5 | Soft delete with subtree; delete a course only in `Draft`; other deletes allowed with warnings | 6.2 |
| D-6 | Progress rules: reorder and same-id edits do not reset progress; deleted ids are tolerated; adding or editing activities never moves a completed lesson back to InProgress; version-aware progress Later | 6.3 |
| D-7 | StemLab stores simulator key + template key + opaque launch options + instructions; no URLs, no simulator documents | 9.1 |
| D-8 | CMS StemLab preview is an iframe on the StemLab authoring form, using the Student Web launch contract | 9.3 |
| D-9 | StemLab templates come from a static CMS list: `blink`, `led-on`, `button-direct`, `button-led`, `empty` | 9.3 |
| D-11 | Content ids are `int` from `Infrastructure`; GUIDs or logical ids reconsidered only for import/export, cloning, cross-environment sync or versioning | 4.3 |
| D-12 | The CMS is a separate ASP.NET Core MVC/Razor project that calls the CourseService API | 8.3 |
| D-13 | Two content scopes: `TenantId = 0` shared, `TenantId > 0` tenant-private; learners see published `own tenant OR 0` | 7.1, 10 |
| D-14 | `CourseService` schema for entity tables and migration history | 13 |
| D-15 | Rich text is Markdown, rendered without raw HTML | 5 |
| D-16 | Student Web reaches the services through the Vite dev proxy | 13 |
| D-17 | Lab work is not stored on the server in the PoC; embed mode never restores a global "last project" | 9.5 |
| D-18 | Completion mode is derived from the activity type and exposed read-only | 5 |
| D-19 | CourseService makes no outgoing service calls in the PoC | 3 |
| D-20 | Graded content (questions, answer keys, scores) is never stored in CourseService; `Assessment` activities hold an `AssessmentId` only | 5.1 |
| D-21 | S1 (simulator embed launch) is mandatory and must land this week, in the stem-demo repo, in parallel | 9.2 |
| D-22 | PoC verification uses repeatable `.http` scenarios; automated integration tests Later | 13 |
| D-23 | Tenant `Id = 0` is reserved for the platform/shared scope; it has a TenantService record, no key and no accounts; SuperAdmin stays tenant `1` | 7.2 |
| D-24 | Management scope by role: tenant admin → its own private courses; SuperAdmin → shared courses only | 7.3 |
| D-25 | Scope is assigned by CourseService and inherited by descendants; never taken from requests; not stamped by `UpdateTenancyInterceptor`; shared scope never inferred from a caller tenant of `0` | 7.4 |

### 14.2 Deferred and Later questions

None of these blocks the PoC.

| Id | Question | When it is answered |
| --- | --- | --- |
| D-10 | Do ungraded inline interactions (poll, reflection) live in CourseService or AssessmentService? | When the first such feature is planned. Graded content stays in AssessmentService |
| D-17 (long term) | Who stores a learner's lab work: LearningService or a future STEM/project service? | When saving lab work is planned |
| — | Published snapshots, revisions and version-aware progress | Content-integrity hardening |
| — | Per-tenant assignment or licensing of shared courses; SuperAdmin managing tenant-private courses | When the business model for shared content is defined |
| — | Shared versus private duplicates (override, tenant copy) | When cloning is planned |

## 15. Tasks and phases

### 15.1 PoC (must-have this week)

The PoC proves one vertical slice: **SuperAdmin publishes a shared course and a tenant admin publishes a private
course → Student Web shows each learner the shared course plus its own tenant's courses → a lesson opens and renders →
each StemLab opens its configured template.**

```text
T0 (reserve platform tenant Id 0, TenantService/AccountService) ─────────────┐
T1 ─► T2 ─► T3 ─► T4 ─► T5 (isolation & lifecycle verification) ◄──────────────┘
       │     │     └──► T8 (Student Web course experience)
       │     └──► T7 (StemLab integration) ◄── S1 (simulator embed launch, stem-demo repo) — MUST land this week
       └──► T6 (Admin CMS: structure screens after T2, activity screens after T3)
T0 + T5 + T6 + T7 + T8 ─► T9 (end-to-end demo)
```

- Critical path: T1 → T2 → T3 → T4 → T8 → T9.
- **S1 must complete before T7 and T9 can pass.** S1 → T7 → T9 is a second critical path, owned by the stem-demo
  repository.
- T0 runs in parallel with T1–T4, but must be done before T5 and T9.
- T7's CMS and Student Web parts are built inside the T6 and T8 screens.

---

**T0 — Reserve the platform tenant `Id = 0` (prerequisite, TenantService/AccountService)**

- **Goal:** the invariant "tenant `0` is the platform/shared scope and is never a normal or login tenant" holds in the
  system, without changing current SuperAdmin behaviour.
- **Scope:**
  - **Create the record:** reserve and create the platform tenant record `Id = 0` through TenantService's migration or
    seeding, in line with the current seeding approach (D-23).
    - EF Core treats `0` as "no value" for a generated `int` key, so this record needs an explicit-id insert.
    - Verify that the explicit `0` is stored correctly in PostgreSQL.
    - Verify that identity generation keeps starting at 1, so no normal tenant ever receives `0`.
  - **Protect the record:**
    - it has no tenant key and no accounts;
    - tenant-key validation can never return `0`;
    - key rotation, update, deactivation and admin-account provisioning refuse tenant `0`;
    - the tenant list hides it or shows it read-only.
  - **Keep SuperAdmin unchanged:** tenant `1`, and the `Tenant == 1 && IsAdmin` checks.
  - **Check uses of `0`:** review every place in AccountService, TenantService and `Infrastructure` where `0` means
    "no tenant" (`CurrentTenantProvider`, `UpdateTenancyInterceptor`, claim parsing) and confirm that the new record
    does not change their behaviour.
  - **Docs:** update `architecture.md`.
- **Technology:** TenantService migration/seeding, EF Core + Npgsql, small guards in TenantService and AccountService
  business code.
- **Proof:**
  - the database holds tenant `0`, and a newly created tenant gets an id ≥ 2;
  - no key validates to `0`, and no token with `Tenant = 0` can be obtained;
  - rotating the key, deactivating or provisioning an admin for tenant `0` is refused;
  - SuperAdmin login and tenant management work as before.

**T1 — Stand up CourseService and its content persistence**

- **Goal:** a running, healthy CourseService that owns the content tables.
- **Scope:**
  - service project following the existing service convention, AppHost registration and per-service Swagger;
  - DbContext and the Course / Module / Lesson / Activity model: audited, soft-deleted, ordered, JSONB settings, and a
    `TenantId` scope column on every row;
  - entity tables and migration history in the `CourseService` schema (D-14); first migration;
  - **scope compatibility (D-25):** CourseService assigns `TenantId` itself and inherits it from the parent. Content rows
    are not stamped by `UpdateTenancyInterceptor`, which would turn a shared `0` into the SuperAdmin's tenant `1`.
    `Infrastructure` is not changed.
- **Technology:** .NET 10, Minimal API, `Infrastructure`, EF Core 10 + Npgsql, PostgreSQL, Aspire.
- **Proof:**
  - the AppHost shows `courseservice` Healthy;
  - `dotnet ef database update` creates the content tables and `"CourseService"."__EFMigrationsHistory"` in the
    `CourseService` schema;
  - a course saved with `TenantId = 0` by a caller of tenant `1` keeps `TenantId = 0`;
  - `architecture.md` describes the new service.

**T2 — Course structure management API (Course, Module, Lesson)**

- **Goal:** an admin can build and maintain a course outline in its management scope through the API.
- **Scope:**
  - course list (paged, filter by status), course detail with outline, create, update, delete (Draft only);
  - module create/update/delete/reorder; lesson create/update/delete/reorder; subtree soft delete;
  - full-sibling-list reorder with stale-list rejection;
  - role-based management scope (D-24: tenant admin → `TenantId = N`, SuperAdmin → `TenantId = 0`) and children
    inheriting the course scope (D-25).
- **Technology:** Minimal API endpoints, business classes returning `BaseResponse`, scope-filtered specifications.
- **Proof:**
  - with an admin token, build a course with two modules and three lessons, reorder them, delete one lesson, and see
    the changes in the course detail;
  - ids do not change across edits and reorders;
  - a SuperAdmin-created course and all its children have `TenantId = 0`; a tenant admin's have its tenant id;
  - a non-admin token is rejected on every management endpoint.

**T3 — Activity model and management API**

- **Goal:** lessons hold ordered, typed, validated activities.
- **Scope:**
  - activity add/edit/delete/reorder; common fields plus per-type settings;
  - a per-type validation registry for `RichText`, `Video`, `StemLab`; the `Assessment` type defined but rejected as
    "not enabled";
  - derived completion mode; URL and size validation;
  - activity scope inherited from the lesson's course.
- **Technology:** JSONB settings, per-type validation in service code.
- **Proof:**
  - a valid activity of each PoC type is stored and returned;
  - invalid settings (missing body, non-http URL, missing template key) are rejected with a clear message;
  - editing and reordering keep activity ids;
  - the stored `StemLab` settings contain no URL and no simulator document.

**T4 — Publish lifecycle and learner-facing read API**

- **Goal:** Student Web can read exactly the published content a learner is allowed to see.
- **Scope:**
  - publish (with validation) and unpublish, for both scopes;
  - learner catalog with the rule "published, `TenantId = callerTenant OR 0`" (D-13), the scope of each course, and
    derived counts;
  - course detail with outline; lesson with ordered activities, completion modes and previous/next lesson ids;
  - empty containers hidden; separate learner projection; the same visibility rule on every lookup by id;
  - the LearningService-facing contract written down (section 12).
- **Technology:** Minimal API, read-only specifications for "own tenant or shared".
- **Proof:**
  - a draft course of either scope is invisible to a student token and visible after publish;
  - unpublish hides it again;
  - a deleted lesson disappears from the outline and from previous/next;
  - previous/next crosses module boundaries in course order.

**T5 — Verify tenant isolation, shared scope and content lifecycle**

- **Goal:** evidence that the scope and visibility rules hold for every endpoint.
- **Scope:** a repeatable `.http` scenario (D-22).
  - **Actors:** shared scope (`TenantId 0`, managed by the SuperAdmin), tenant A (admin, learner), tenant B (admin,
    learner).
  - **Content:** in each scope, one published and one draft course.
  - **Coverage:** every management and learner endpoint. Try to read, update, delete, reorder, publish and unpublish
    content outside the caller's scope by id.
  - **Matrix:**

  | Actor | Must see / manage | Must not see / manage |
  | --- | --- | --- |
  | Learner A | shared published, tenant A published | tenant B (any), shared Draft, tenant A Draft; any management endpoint |
  | Learner B | shared published, tenant B published | tenant A (any), shared Draft, tenant B Draft; any management endpoint |
  | Admin A | manage tenant A private content | manage tenant B content; manage, publish or delete shared content (calls on shared ids return "not found") |
  | Admin B | manage tenant B private content | manage tenant A content; manage shared content |
  | SuperAdmin | create, edit, publish, unpublish, delete shared content | tenant-private content through management endpoints (Later) |
  | No usable tenant | — | everything; also confirm that no token with `Tenant = 0` can be obtained (T0) |

- **Technology:** `CourseService.http`, Swagger, tenants and accounts created through TenantService and AccountService.
- **Proof:**
  - every row of the matrix passes;
  - forbidden attempts return "not found" or are rejected, and nothing changes in the other scope's data;
  - children of every course carry the course's `TenantId`;
  - the matrix and its results are recorded. It is re-run in T9.

**T6 — Admin CMS authoring workflows**

- **Goal:** tenant admins and the SuperAdmin author and publish courses in their own scope without Swagger.
- **Scope:**
  - the workflows in section 8.1 for both scopes: sign-in with the scope shown, course list, course editor with
    outline;
  - module, lesson and activity forms for the three PoC types;
  - reorder (up/down is enough), delete confirmations, publish/unpublish, validation errors;
  - the "live course" warning, with "all tenants" for shared courses;
  - a separate MVC project (D-12).
- **Technology:** ASP.NET Core MVC/Razor, cookie sign-in carrying the JWT, typed HTTP client to CourseService and
  AccountService.
- **Proof:**
  - the CMS parts of the demo (section 16) are done entirely in the CMS, by the SuperAdmin and by a tenant admin;
  - a tenant admin never sees an edit action for a shared course;
  - a non-admin account cannot enter.

**T7 — StemLab integration**

- **Goal:** a `StemLab` activity opens the correct configured template, in the CMS preview and in Student Web.
- **Scope:**
  - CMS template picker from the static list (D-9) and the iframe preview on the authoring form (D-8);
  - the launch-URL rule shared by the CMS and Student Web; simulator base URL configured per environment;
  - iframe `allow`/`sandbox` checks; error state.
  - **Depends on S1** (section 9.2, D-21), which must be complete for this task to pass.
- **Technology:** configuration via Aspire, iframe embedding, the S1 embed launch contract.
- **Proof:**
  - a `blink` activity shows the Blink project and a `button-led` activity shows the Button LED project;
  - opening one lab never shows the other lab's circuit or a standalone "last project";
  - the CMS preview matches Student Web.

**T8 — Student Web course experience (consumer work for the demo)**

- **Goal:** the minimum learner UI that proves the learner API.
- **Scope:**
  - sign-in through AccountService;
  - course catalog listing shared and own-tenant courses; course page with the module/lesson outline;
  - lesson player: one activity per screen, Previous/Next activity, previous/next lesson;
  - renderers for `RichText`, `Video`, `StemLab`;
  - "not available" state for unpublished, missing or out-of-scope content;
  - no progress, resume or completion UI.
- **Technology:** React + TypeScript + Vite, Vite dev proxy (D-16), Markdown renderer with raw HTML off.
- **Proof:** the Student Web parts of the demo (section 16) work against content created in the CMS.

**T9 — End-to-end demo and documentation**

- **Goal:** run the vertical slice from section 16 on a clean environment and record the result.
- **Scope:** fresh database including T0's platform tenant, the demo script, the T5 matrix re-run, and `architecture.md`
  updated to the implemented state.
- **PoC success criteria:**
  - the demo runs end to end without manual database edits;
  - learners of tenant A and tenant B see the shared course plus only their own tenant's courses;
  - **every StemLab opens its correct configured template** (`blink` → Blink, `button-led` → Button LED), with S1 in
    place and no fallback;
  - the T5 matrix passes;
  - the known PoC limits (live edits, no progress, no server-side lab work) are written down.

### 15.2 Later / production hardening

Kept out of the PoC on purpose:

- **Content integrity:** working copy and published snapshot (or revisions); lesson-level drafts; per-activity
  revision and version-aware progress; optimistic concurrency; `Archived` state; restore of deleted content; audit
  history.
- **Authoring:** approval workflow; rich (WYSIWYG) editor; drag-and-drop; moving lessons and activities between
  parents; duplicate and clone course (including shared → private copies); bulk operations; import/export; full-lesson
  draft preview.
- **Activity types:** `Assessment` with AssessmentService; `Poll`, `Ordering`, `Classification`, `DataTable`, `Rubric`,
  `ClassVote`; multi-block slides; author-set optional/required flag.
- **Media:** MediaService integration with a platform scope, upload, image variants, video pipeline, captions, external
  video providers.
- **STEM simulator:** `postMessage` events and simulator-driven completion; lab kept mounted across activities;
  server-side lab work storage (D-17); template catalog API; CSP and sandbox hardening.
- **Catalog and business:** learning paths, taxonomy for category/level/age, search, XP rules, per-tenant assignment or
  licensing of shared courses, public catalog and preview without sign-in, localization.
- **Permissions:** content-author role, SuperAdmin management of tenant-private courses, per-course permissions,
  enforcement of `Permissions`.
- **Operations:** automated integration tests, caching of published content, API gateway or CORS policy, content-change
  events once a broker exists.

## 16. PoC vertical demo scenario

Prerequisites:

- the platform tenant `0` exists (T0);
- the SuperAdmin account exists;
- tenants **A** and **B** exist, each with an admin account and a student account;
- the simulator runs with S1.

```text
Platform CMS (SuperAdmin)
  1. Sign in with the SuperAdmin tenant key. The CMS shows "Shared platform content".
  2. Create shared course "Làm quen với nút nhấn" → module → lesson → RichText + StemLab (template "button-led").
     The preview shows the Button LED circuit.
  3. Publish. The course has TenantId = 0.

Tenant CMS (admin of tenant A)
  4. Sign in with tenant A's key. The course list does not offer the shared course for editing.
  5. Create private course "Mạch điện cơ bản" (Draft): summary, description, cover image URL, objectives.
  6. Create module "Đèn LED", then lesson "Làm đèn LED nhấp nháy" (kind Lab).
  7. Add RichText (introduction with an image), Video (.mp4 URL with a poster), StemLab (template "blink").
     The preview shows the Blink circuit.
  8. Reorder: move the Video before the RichText, then back.
  9. Publish.

Student Web (student of tenant A)
 10. Sign in. The catalog shows "Làm quen với nút nhấn" (shared) and "Mạch điện cơ bản" (tenant A).
 11. Open "Mạch điện cơ bản" → lesson: three activities in the authored order. Read, play the video,
     open the StemLab: the Blink circuit loads and runs.
 12. Open the shared course's StemLab: the Button LED circuit loads. Return to the first lesson: Blink again.

Student Web (student of tenant B)
 13. Sign in. The catalog shows only "Làm quen với nút nhấn". A direct link to tenant A's lesson reports "not available".

Negative checks
 14. Admin of tenant A tries to edit or unpublish the shared course (CMS or API): refused / "not found".
 15. Admin of tenant B: the CMS shows none of tenant A's courses.
 16. A Draft course of tenant A and a Draft shared course do not appear for either student.
 17. SuperAdmin unpublishes the shared course: it disappears for both students.
```

Not part of this demo: progress, completion, resume and XP. They belong to LearningService. The demo only shows that
the ids and completion modes LearningService will need are already in the learner API.

## 17. Risks

| Risk | Mitigation |
| --- | --- |
| S1 does not land this week | S1 is on the critical path and owned in the stem-demo plan; track it daily. Emergency fallback only: open the simulator's default project with instructions naming the circuit. If used, T7 and T9 are recorded as **not met** |
| `0` has two meanings: "no tenant" in `Infrastructure`, "shared scope" for content | Shared scope comes only from the SuperAdmin check (D-25); requests without a usable tenant are rejected; content rows are not stamped by the interceptor (T1 proof); T0 makes a `Tenant = 0` token impossible |
| Seeding an explicit `Id = 0` with EF Core goes wrong (`0` read as "no value") | T0 uses an explicit-id insert and verifies the stored row and the identity start |
| Live edits of a published course expose half-finished content, for all tenants if the course is shared | CMS warning that names "all tenants" for shared courses; unpublish for large edits; snapshot publishing Later |
| A query misses the scope filter (filtering is explicit, not global) | Every content table carries `TenantId`; the T5 matrix covers every endpoint and all three scopes; automated tests Later |
| A child row gets a different scope from its course | Scope copied from the parent only (D-25); T2 and T5 proofs check children |
| Activity ids churn because an editor saves by delete and recreate | Rule in section 4.3; T3 proof checks id stability |
| Iframe embedding blocked by headers or sandbox | Part of S1 (point 4) and checked in T7; the simulator's plan allows dropping COOP/COEP |
| Scope creep from production features | Section 15.2 is the parking lot; PoC exit is the section 16 demo |
