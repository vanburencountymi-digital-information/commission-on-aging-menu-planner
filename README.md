# COA Menu Planner — Team Development Guide

> The client's original README has moved to [`docs/CLIENT_README.md`](docs/CLIENT_README.md).

## 1. Project overview

The COA Menu Planner is a menu-planning application for the St. Joseph County Commission on Aging. The goal is to support staff as they plan, review, approve, and print menus while respecting the Commission's operational and dietary requirements.

The shared application repository is a Node.js/Express API and React/Vite frontend:

- `apps/api/` — Node.js + Express backend
- `apps/web/` — React + Vite frontend
- `coa-tests/` — test suite
- `docs/` — project documentation and architecture decisions
- `CLAUDE.md` — repository-specific instructions for Claude
- `.env.example` — names and examples of required environment variables; never put real secrets here

> **Important:** The populated repository is the starting codebase. Do not recreate its features from scratch, replace its architecture, or assume a feature is missing until you have inspected the implementation.

## 2. What is already built

The current prototype includes the following functionality. Treat this list as a starting inventory, not proof that every feature is production-ready. Verify behavior in the code and browser before changing it.

### Menu calendar and editing
- Month, week, and list calendar views.
- Selecting a date opens a menu editor.
- Separate menu components for entrée, grain, vegetable sides, fruit, bread, and milk.
- A single Daily menu is the default; do not assume breakfast, lunch, and dinner are all required.

### Bulk copying
- Copy a day's menu to multiple destination dates from the calendar.
- Destination dates can span months.
- Shortcuts support weekdays, empty dates, and whole weeks.
- Preview changes before applying them.
- Existing meals are preserved by default.
- Undo can reverse a batch operation.

### Reusable plans and importing
- Save and reuse weekly or multi-week plans.
- Upload a CSV or paste spreadsheet rows.
- Match columns and review imported entries before importing.

### Planning checks and statuses
- Settings determine which dates require planned menus.
- Checks can flag missing entries, incomplete menu components, repeated meals, and dietary-review reminders.
- Draft, under-review, and approved labels are represented.
- These are prototype checks and simulated statuses, not nutrition certification or a complete approval workflow.

### Tutorial, saving, and presentation
- Guided tutorial covers real screens and features and uses separate sample data.
- Local saving, data export/restore, printable view, and downloadable copy.
- Responsive layout and interface refinements.

### Cost display
- The $5-per-meal target may be displayed alongside supplied cost information.
- The calendar must not invent recipe costs or treat unknown costs as zero.
- Do not claim that recipe costing or budget enforcement is complete unless verified in the code.

## 3. Team roles and implementation assignments

Each analyst owns the feature area below. Before coding, inspect the existing frontend, API routes, database schema/migrations, and tests. Reuse existing patterns and data models where possible. Do not create duplicate systems.

### Aiden — Calendar, account-specific views, and printable calendar

**Current starting point / findings**
- Calendar functionality already includes month, week, and list views, menu editing, bulk copying, reusable plans, and imports.
- Aiden is considering different views for different account types.
- The calendar PDF/printable layout may need UI improvements.
- The exact permissions and visibility rules for each account type still need to be agreed on.

**Implementation plan**
1. Review the current calendar components, menu editor, print/PDF implementation, and account/role model.
2. Document which account types exist and what each account should be able to view or edit. Do not invent permissions; confirm unclear rules with the project manager/client.
3. Propose a role-to-view/permission matrix and review it with the team before implementing.
4. Implement only the agreed role-specific visibility and actions. Enforce access restrictions in the backend as well as hiding controls in the frontend.
5. Review the printable/PDF calendar for clipping, page breaks, readability, missing menu components, and consistency with the on-screen menu.
6. Add or update tests for role-based access and print-related data/rendering behavior where the existing test setup allows it.

**Deliverables**
- A documented role/view matrix approved by the team.
- Implemented, tested role-specific calendar behavior, once requirements are confirmed.
- Improved printable/PDF calendar, if confirmed as a priority.
- Screenshots or a short demo showing the behavior.

**Acceptance criteria**
- Users cannot access data or actions they are not authorized to use, including through direct API requests.
- Each role sees only the agreed views/actions.
- Printed/exported menus contain the correct dates and all required menu components and are readable.

### Alice — Approval pipeline and recipe repetition controls

**Current starting point / findings**
- The nutritional manager should not be removed by assumption; the team believes this role may be central to the workflow.
- Kitchen staff reportedly cannot see items under "Current Menu." This needs to be reproduced and traced through the frontend, API, permissions, and database before changing code.
- Price and budget information may be useful in the order list.
- Potential UI work includes improving the calendar PDF; coordinate with Aiden to avoid duplicate work.
- Proposed repetition controls include ingredient-use summaries, recipe cooldown periods, unused-ingredient flags, and configurable cooldown days.

**Implementation plan**
1. Trace the existing approval/status workflow from UI to API to database. Identify which statuses and role permissions are real versus simulated prototype labels.
2. Reproduce the kitchen staff "Current Menu" visibility issue. Check API responses, authorization rules, filters, and frontend rendering. Record the root cause before fixing it.
3. Confirm the actual workflow and role names with the project manager/client. Preserve the nutritional manager role unless the client explicitly changes it.
4. Implement the smallest agreed approval workflow using the existing role and status patterns. Enforce approval permissions on the backend.
5. For repetition controls, first locate existing recipe/menu history and ingredient relationships. Confirm the desired cooldown period and whether the rule applies to a recipe, ingredient, or both.
6. Implement configurable recipe cooldown days only after the rule is confirmed. Provide a clear reason when a recipe is blocked or flagged.
7. Treat ingredient-use summaries and "purchased but unused" flags as separate enhancements; they depend on reliable ingredient quantities and recipe-to-ingredient data. Coordinate with Ravi.
8. Coordinate with the project manager before adding price/budget information to an order list. Use supplied cost data only; never infer missing costs.

**Deliverables**
- Reproduction notes and root-cause explanation for the kitchen staff visibility issue.
- Fixed and tested visibility behavior, if confirmed as a defect.
- Documented approval states, roles, and permissions.
- Agreed, tested recipe repetition rule or a scoped implementation proposal if requirements are not yet confirmed.

**Acceptance criteria**
- Kitchen staff can see the correct current menu if their role is meant to have that access.
- Only authorized roles can approve or change approval states.
- Cooldown rules use configured values and explain why a recipe is unavailable.
- No unverified price, budget, or ingredient-use data is presented as fact.

### Ritvik — Dietary labels, restriction warnings, and nutrition clarity

**Current starting point / findings**
- Recipes need clear pork/fish dietary information and restriction filters.
- Missing or unverified dietary data must display as "Not verified", not as safe/clear.
- A restriction warning should catch conflicts such as a "No blueberries" restriction when a blueberry muffin is scheduled.
- Missing nutrition information must display as "Nutrition unavailable", not zero.
- Users should be able to see which recipes contribute to nutrition totals.
- Potential later enhancements: verification history and reviewed alternative meals.

**Implementation plan**
1. Inspect recipe, ingredient, menu, dietary restriction, and nutrition data models and existing checks.
2. Identify which dietary attributes are explicitly stored and which are absent. Do not infer that a recipe is pork-free, fish-free, allergen-free, or otherwise compliant from missing data.
3. Define the supported dietary labels and the meaning of each value, including verified, contains, does not contain, and not verified. Confirm the terminology with the project manager/client.
4. Add or update backend data/API support for dietary attributes only where needed, using existing schema conventions and migrations.
5. Add recipe labels and filters to the frontend. Ensure filters distinguish "does not contain" from "not verified."
6. Compare scheduled meals against the applicable restrictions and display actionable warnings with the conflicting ingredient/recipe where the data supports it.
7. Update nutrition displays so missing values are represented as unavailable, not numeric zero. Show which recipes are included in any displayed totals and avoid presenting incomplete totals as complete.
8. Add tests for missing data, known conflicts, non-conflicts, filters, and nutrition display.
9. If time allows, propose verification tracking (who/when) and reviewed alternatives as separate follow-up work. Do not automatically substitute meals without staff approval.

**Deliverables**
- Dietary data/label definition.
- Recipe dietary labels and filters.
- Restriction-conflict warnings.
- Clear handling of missing nutrition data and visible recipe contribution details.
- Tests covering verified, conflicting, and unknown data.

**Acceptance criteria**
- Unknown dietary information is always clearly marked "Not verified."
- Known conflicts are flagged; unknown data is not silently treated as compliant.
- Missing nutrition data is not shown as zero.
- Nutrition totals identify their included recipes and are not described as certified or complete when data is missing.

### Ravi — Ingredient inventory

**Current starting point / findings**

The proposed inventory feature includes:
- Add, edit, and remove ingredients.
- Track the quantity currently available.
- Record purchases and ingredient usage.
- Store units such as lbs, oz, and cups.
- Track allergens for each ingredient.

Ravi has asked whether ingredient-level nutrition information and ingredient costs/suppliers (such as GFS and Sun Valley) should be included. These are scope decisions, not assumptions. Ask the project manager/client before expanding the feature.

**Implementation plan**
1. Inspect the existing ingredient and recipe schemas, migrations, API routes, and UI. Determine whether inventory functionality already exists in whole or in part.
2. Propose an ingredient record with the minimum confirmed fields: name, quantity on hand, unit, and supported allergen information. Confirm how allergens should be represented and verified.
3. Agree on how stock changes are recorded. Prefer a traceable inventory transaction/history (purchase, usage, adjustment) over silently overwriting a quantity, if consistent with the existing architecture.
4. Define and validate allowed units. Do not add automatic conversions between incompatible units unless conversion rules are explicitly implemented and tested.
5. Build backend validation and API operations before or alongside the UI. Prevent negative or invalid quantities unless the client explicitly requires a different behavior.
6. Build screens/forms for listing, adding, editing, removing, receiving stock, and recording usage.
7. Coordinate with Ritvik on ingredient allergen data and with Alice on ingredient-use/repetition summaries.
8. Ask the project manager/client whether these belong in the first inventory release:
   - Ingredient nutrition fields (calories, protein, carbohydrates, fat, fiber, sodium).
   - Ingredient costs and supplier information (e.g., GFS and Sun Valley).

   If approved, decide whether they belong in inventory, procurement, or a separate costing feature before implementing them.
9. Add tests for quantity changes, units, validation, allergens, and inventory history.

**Deliverables**
- A short data model proposal and list of unresolved scope questions.
- Working ingredient CRUD and stock tracking for confirmed requirements.
- Allergen fields/labels with clear handling of unknown information.
- Tests and a short demo.

**Acceptance criteria**
- Authorized staff can add, view, edit, and remove ingredients.
- Stock changes are recorded accurately and use clear units.
- Invalid quantities and unsupported unit conversions are handled safely.
- Missing allergen information is not treated as allergen-free.
- Nutrition, costs, and suppliers are only included if the scope is approved.

### Shared — AI-assisted menu completeness review (reassigned from Samarth)

Ownership is split by layer:
- **Ritvik:** six-component completeness validator and its tests (steps 4, 11).
- **Aiden:** review screen and loading/error/retry states (steps 5, 7).
- **Alice:** draft-only behavior and authorized acceptance only (steps 3, 6), since it reuses her approval-pipeline permissions.

Steps 1–2 (inspecting and mapping the AI flow) are done together by all three before anyone codes. Steps 8–10 are open scope questions for the project manager, not assigned implementation work.

**Current starting point / findings**
- The main proposed improvement is to check AI-generated menus for all six required components before acceptance: entrée, grain, vegetable, fruit, bread, and milk.
- Incomplete weekdays should be flagged in a review screen.
- AI suggestions must remain drafts until the Nutrition Manager accepts them; generation must not overwrite an existing menu.
- Potential add-ons: generate Monday–Friday only, show loading/error/retry states, flag meals over the $5 target when cost data exists, and choose from existing in-house/GFS recipes.
- Do not change the AI model or AI connection as part of this assignment.
- The populated coa-menu-planner repository is the intended codebase; verify access and inspect its AI implementation before coding.
- Alice's acceptance step depends on the approval states and Nutrition Manager permissions being documented first; Ritvik's validator and Aiden's review screen can start before that.

**Implementation plan**
1. **(All three)** Inspect `CLAUDE.md`, existing AI-related code, API routes, prompt construction, menu data model, and tests. Search for existing generation and validation behavior before creating anything.
2. **(All three)** Trace the complete flow: user request → backend generation endpoint → AI response → parsing/validation → draft/review UI → acceptance/save.
3. **(Alice)** Confirm that generated menus are represented as drafts and identify how acceptance is authorized. Reuse the Nutrition Manager permissions and approval behavior from the approval pipeline work rather than defining them separately.
4. **(Ritvik)** Implement a completeness validator for each generated weekday. Check all six required components and identify the missing component(s).
5. **(Aiden)** Display incomplete days and missing components in a review screen. Do not silently fill missing fields or accept incomplete results.
6. **(Alice)** Ensure generation never overwrites an existing menu. Require an explicit authorized acceptance action before applying a generated draft.
7. **(Aiden)** Add clear loading, failure, and retry states. Avoid exposing API keys or sensitive backend errors in the browser.
8. Confirm whether generation should cover Monday–Friday only. Do not change weekend behavior until confirmed.
9. Treat $5 budget warnings as a later enhancement dependent on reliable cost data. Do not treat unknown costs as zero.
10. Treat selecting only existing in-house/GFS recipes as a separate scope decision. Do not claim it is implemented unless generation is actually constrained to those records.
11. Each owner adds tests for their part: complete menus, each missing component, generation failures, retries, draft preservation, and acceptance behavior.

**Deliverables**
- A documented map of the current AI generation flow.
- Six-component completeness validation.
- Review UI that identifies missing components.
- Draft-first behavior that does not overwrite saved menus.
- Loading/error/retry states.
- Tests and a short demo.

**Acceptance criteria**
- Each generated weekday is checked for all six required components.
- Missing components are clearly identified.
- Generated suggestions remain drafts until an authorized user accepts them.
- Existing saved menus are not overwritten by generation.
- Failures are visible and recoverable through a retry action.
- No AI model/provider integration changes are made in this assignment.

## 4. Shared implementation rules

1. **Inspect before coding.** Search the repository for existing components, API endpoints, database tables, migrations, and tests. Extend existing patterns rather than duplicating them.
2. **Confirm requirements.** If a rule, role, field, or workflow is unclear, write down the question and ask the project manager/client. Do not invent business rules.
3. **Frontend and backend both matter.** Hiding a button is not authorization. Enforce permissions and validation in the API.
4. **Database changes require migrations.** Follow the existing migration pattern and document how to apply changes. Do not edit a production database manually.
5. **Protect existing data.** Do not run destructive migrations, reset shared databases, or overwrite real menus without explicit approval.
6. **Test changes.** Add/update tests for the behavior changed. Run the relevant tests and report the exact command and result.
7. **Keep scope controlled.** Implement the agreed minimum first. Label optional enhancements as follow-up work.
8. **Do not claim certification.** Prototype dietary checks and nutrition displays are not dietitian approval or regulatory certification.
9. **Do not invent data.** Missing costs, nutrition, allergens, and dietary attributes must remain unknown/unavailable until verified.
10. **Never commit secrets.** Do not commit `.env`, credentials, API keys, passwords, service-account files, or database dumps.

## 5. Git workflow for the team

Everyone works from this team repository. `main` is protected, so all changes go through pull requests.

**Branch names**

| Person | Branch |
|---|---|
| Aiden | `feat/aiden-calendar` |
| Alice | `feat/alice-approval-ai` |
| Ritvik | `feat/ritvik-dietary` |
| Ravi | `feat/ravi-inventory` |

Each person's part of the shared AI completeness review goes on their own branch above.

**For each task**
1. Start from the latest team `main`.
2. Create (or switch to) your assigned branch.
3. Make small, related commits.
4. Run relevant tests and inspect the diff.
5. Push the branch and open a pull request into the team `main`.
6. In the PR, explain the problem, implementation, tests run, screenshots if UI changed, and any remaining questions.
7. Request review from the project manager or another teammate.
8. Merge only after review and passing checks.

Do not all work on the same branch. Do not force-push shared branches. Do not merge directly into `main` without review.

## 6. Relationship to the client repository

The client's original repository is:

https://github.com/vanburencountymi-digital-information/coa-menu-planner

Its code has already been imported into this team repository. Only the current files were copied, not the client's commit history, because an old commit in that history contained an API key, which GitHub blocks.

**If the client later makes changes the team needs:** do not merge the client's history into this repo, because the push will be blocked for the same reason. Instead, compare the changed files and copy them over on a separate branch, then open a PR as usual. Coordinate with the project manager before doing this.

## 7. Local development setup

The client's README ([`docs/CLIENT_README.md`](docs/CLIENT_README.md)) documents this local workflow. Follow the current `CLAUDE.md` and package scripts if they differ.

### Requirements
- Node.js 20 (the repository includes `.nvmrc`)
- npm
- Access to the required development database and approved environment variables

### Install dependencies
From the repository root:

```bash
npm install
```

### Configure environment
- Use `.env.example` as the reference for required variable names.
- Follow `CLAUDE.md` for which environment file belongs in which directory.
- Never copy real secrets into this README, a Claude prompt, GitHub issue, commit, or pull request.
- Do not retrieve or share production secrets as part of routine setup. Ask the project owner for approved development credentials and access.

### Start the API
In Terminal 1, from the repository root:

```bash
npm run dev:api
```

The API is documented to run on port 3001.

### Start the frontend
In Terminal 2, from the repository root:

```bash
npm run dev:web
```

The frontend is documented to run on port 3000 and proxy `/api` requests to the API.

### Database
The documented application database is PostgreSQL on Google Cloud SQL. Local database setup may require the Cloud SQL Auth Proxy and approved database access. Follow `docs/CLIENT_README.md` and `CLAUDE.md` for the current setup. Do not run migrations or seeds against a shared/production database unless the project owner explicitly authorizes it.

### Tests
Inspect `package.json`, `coa-tests/`, and `CLAUDE.md` to identify the correct test commands. Run the relevant tests before opening a PR and include the exact command and result in the PR description. Do not assume a test command that is not defined in the repository.

## 8. How each person should use Claude

Each analyst should open Claude Code in the team repository working directory and give it the root `CLAUDE.md` and this README as project context. Claude should inspect the actual code before suggesting edits.

### Shared starting prompt
Copy and adapt this prompt:

```text
You are helping with the COA Menu Planner repository. First read
CLAUDE.md, README.md, and the relevant architecture documentation.
Inspect the existing implementation, database schema/migrations, API
routes, frontend components, and tests related to my assigned feature.

Do not assume the feature is absent. Report what already exists,
identify the files and data flow involved, and propose the smallest
implementation plan that fits the existing architecture. Do not
rewrite unrelated code, introduce duplicate systems, change the AI
provider/model, or invent client requirements.

Before editing, list the files you expect to change and explain why.
Ask me before making a database migration, destructive change, broad
refactor, or change to permissions/business rules that have not been
confirmed.

Implement only the agreed scope. Add or update tests, run the relevant
checks, inspect the final diff, and summarize changed files, behavior,
tests run, and any remaining questions. Never expose or commit
secrets.
```

### Role-specific Claude prompts

**Aiden**
```text
My assignment is calendar/account-specific views and, if prioritized,
printable calendar improvements. Inspect the existing calendar,
user/role model, API authorization, and print/PDF implementation.
First report what already exists. Identify the roles and access rules
already implemented; do not invent new ones. Propose a role/view
matrix for team approval before coding. Then implement only approved
role-specific behavior, enforce access in the backend, improve the
print/PDF output if assigned, and add tests.
```

**Alice**
```text
My assignment is the approval pipeline and recipe repetition controls.
Trace the current menu status/approval flow and reproduce the reported
issue where kitchen staff cannot see the Current Menu. Identify the
actual root cause before editing. Preserve the Nutrition Manager role
unless requirements explicitly say otherwise. Inspect recipe and menu
history before proposing cooldown rules. Ask for confirmation of
cooldown behavior and priority before implementing it. Add backend
authorization and tests.
```

**Ritvik**
```text
My assignment is dietary labels, restriction warnings, and
nutrition-data clarity. Inspect the existing recipe/ingredient/menu
data model and validation logic. Do not infer that missing dietary
data means a recipe is safe or compliant. Use "Not verified" for
unknown dietary data and "Nutrition unavailable" for missing nutrition
values. Identify known restriction conflicts and show which recipes
contribute to totals. Implement tests for missing, verified, and
conflicting data. Treat verification history and alternative meal
suggestions as optional follow-up work.
```

**Ravi**
```text
My assignment is ingredient inventory. Inspect existing ingredient,
recipe, and stock-related models and APIs before creating new ones. My
confirmed feature scope is ingredient add/edit/remove, quantity on
hand, purchase/usage updates, measurement units, and allergen
tracking. Propose a data model and transaction/history approach first.
Do not add ingredient nutrition fields, costs, or suppliers until the
project manager/client confirms those requirements. Coordinate with
Ritvik on allergens and Alice on ingredient-use summaries. Add
validation and tests.
```

**AI completeness review (shared: Ritvik, Aiden, Alice)**
```text
My assignment is my part of the AI-generated menu completeness review:
Ritvik = completeness validator, Aiden = review UI and
loading/error/retry states, Alice = draft-only behavior and acceptance.
Work only on my part and coordinate with the other two. Inspect the
current generation endpoint, prompt/response handling, draft/save
flow, review UI, permissions, and tests. Do not change the AI model or
provider integration. Validate every generated weekday for entrée,
grain, vegetable, fruit, bread, and milk. Show missing components
before acceptance. Ensure generated suggestions remain drafts and
never overwrite existing menus until an authorized user explicitly
accepts them. Add loading, error, and retry states. Confirm
weekday/weekend behavior before changing it. Add tests for missing
components, failures, and draft preservation.
```

## 9. Questions to resolve before expanding scope

Track these as project decisions rather than letting individual developers guess:

1. What account roles exist, and exactly what can each role view, edit, approve, or print?
2. What is the intended approval sequence, and what is the Nutrition Manager's authority?
3. Should kitchen staff see the Current Menu, and which dates/programs should be visible?
4. What is the recipe cooldown rule? How many days, and can the Nutrition Manager configure it?
5. Which dietary restrictions and labels must be supported, and who verifies the data?
6. Should ingredient inventory include nutrition fields, costs, and supplier records in this release?
7. Which units and conversions are required for inventory?
8. Should AI generation be restricted to Monday–Friday and/or existing in-house and GFS recipes?
9. What cost data is reliable enough to support the $5-per-meal target?
10. Which changes are required for the first delivery versus later enhancements?

## 10. Suggested team delivery sequence

1. **Repository onboarding:** import the populated codebase, run it locally, read `CLAUDE.md`, and map existing functionality.
2. **Feature discovery:** each analyst identifies existing code, missing behavior, dependencies, and open client questions.
3. **Agree on scope:** project manager confirms priorities and resolves cross-feature decisions.
4. **Implement in small branches:** one focused feature per branch, with tests.
5. **Integrate and review:** PR review, test the combined workflow, and resolve cross-feature conflicts.
6. **Client validation:** demonstrate the completed behavior and record feedback before expanding scope.

> **Project management principle:** a feature is not complete because the UI looks finished. It is complete when the agreed behavior works end-to-end, permissions and data handling are correct, tests pass, and the team can demonstrate it.
