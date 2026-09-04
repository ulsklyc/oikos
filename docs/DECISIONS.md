# Decisions made once

[SCOPE.md](SCOPE.md) says what Yuvomi will not become. This page is for the other kind of
answer: something Yuvomi does build, where the *shape* was argued out once in a thread and
would otherwise be argued again in the next one. Each entry states the rule in a sentence or
two, the reason, where the rule lives in the code, and what would reopen it. The full
reasoning stays where it was made - in the thread and in the CHANGELOG entry of the release
that shipped it - and this page points there rather than restating it a third time.

An entry earns its place when a decision reached in one thread has been reached again,
independently, in another. That is the sign it will be argued a third time. How a single
feature works belongs in [SPEC.md](SPEC.md); anything not built yet belongs in the
[backlog](../BACKLOG.md).

---

## 1. Privacy beats admin convenience

**Access to a member's private data is never implied by a role, and never widened by an
update.** It is granted per person, by an explicit and visible act, and the default is
closed.

Yuvomi is a household planner, not a company tool. The admin is usually a parent, and the
other members are partners, teenagers and grandparents with a privacy of their own. Somebody
who marked an entry private did so trusting that private means private. A right that reaches
into existing private data cannot be inferred from a field people filled in for another
purpose, and cannot be narrowed silently on update: permissions can be opened later, but what
somebody has already seen cannot be unseen.

The same rule was reached three times, each time from a different module:

- **Health, v1.83.0 (#584).** Asked for as a property of the family role - dad, mum,
  guardian. Built as a per-person grant an admin sets under Settings → Family, because the
  role version would have given two people read access to the private health data of
  everyone carrying the role "child" the moment they updated, including the seventeen-year-
  old who has that role only because it fit best. Until somebody sets a grant, nothing
  changes for anybody. A grant covers reading as well as writing, since a caregiver who could
  write but not read would lose sight of the reading they just took; the cycle diary is
  excluded, because giving medicine is care and reading someone's cycle diary is not.
- **Invitations, v2.62.0 (#869).** A new member used to start with every module. That was
  never decided for invitations: it was inherited from migration v74, where storing
  permissions sparsely was the right call so that existing households behaved exactly as
  before. The invite path got its own answer - a *starting permissions* field, preselected to
  *Without personal areas*, which locks Health, Budget and Documents, with the resolved set
  stored on the invitation. The stored default was left alone, so no household changed on
  update. There is deliberately no "full access" template: a member override cannot widen a
  role profile, and a template that quietly does nothing would be a promise that does not
  hold.
- **Documents, review of PR #989 (September 2026).** The destructive folder delete skipped
  the ownership check for admins, so an admin could permanently delete a member's private
  document that the single-document path would not even show them. Decided in review: the
  visibility rule stands and admins do not override it. The subtree is selected through the
  one visibility rule and refused as soon as one row in it is invisible to the caller;
  sharing a single document deliberately is the owner's act, and that path already exists.

The task lock in v2.30.0 rests on the same reasoning from the other side: a family role says
who somebody is, not what they may do, and Yuvomi had already replaced that inference with
explicit grants once.

### Where the rule lives

One rule, one place, so a future change cannot be forgotten in a copy:

- **Documents:** `documentVisibleSql()` in `server/services/document-access.js` has exactly
  three branches - creator, family visibility, explicit share - and no admin branch. Every
  path that hands out documents goes through it, including the modules that only link them.
- **Tasks and events:** `visibilityWhere()` in `server/services/visibility.js`, enforced on
  the server and without an admin bypass (#474).
- **Health:** `server/routes/health/caregivers.js`. Grants are per person, managed by admins,
  and every member can read their own.
- **Invitations:** `INVITE_PRESETS` in `server/permissions.js`, default `restricted`, and the
  invite handler in `server/auth.js`, where a *missing* field means the narrow template so
  that an older client cannot invite with full access by accident.

### What would reopen it

Whether an admin should ever see past the visibility rule is a real question, and it has an
address: #1007, member visibility as its own axis. If the answer there is ever yes, the change
goes into `document-access.js` - one rule, all paths, one test - and never into an `isAdmin`
check at a single call site. Until then, an admin who cannot see a document still has the
non-destructive path, and a pull request that adds an admin exception to any of the four
places above is undoing this decision rather than extending it.

---

## 2. A rule lives in one place, not at a call site

**Whatever decides who may see, write or store something exists once, as a function every
path calls, and never as a second copy at the place that happens to need it.** A copy is not
a shortcut. It is a second answer, waiting to diverge from the first.

Every copy is a place a future change can miss, and a missed copy fails silently: nothing
errors, one path simply answers differently from the other. Each time that happened here it
was found from outside, after it had shipped, by somebody comparing two paths to the same
data.

The rule was reached three times within the same two days of September 2026, from three
different shapes of copy:

- **An inlined check, review of PR #989.** The destructive folder delete selected its subtree
  without the document visibility rule and put an `isAdmin` check of its own in its place. Two
  paths to the same document gave two answers: the single-document path told an admin that a
  member's private document did not exist, the folder path deleted it. Decided in review: the
  subtree goes through the one visibility rule, and if admins are ever to see past it, that
  change goes into `document-access.js` - one rule, all paths, one test.
- **A second regex, #1013.** The storage check for dashboard widget ids was written without
  ever seeing how `fullWidgetId()` composes them, so it knew nothing of the colon in
  `<module-id>:<widget-id>`, and every layout containing a third-party widget was refused
  whole. Fixed in #1015 by moving the notation to where the composition is, with the storage
  check built from the same parts instead of imitating them.
- **A condition on a future build, #1007.** Member visibility, if it is built, comes with two
  conditions: every list of people goes through a single predicate, the way documents go
  through `documentVisibleSql()`, and all screens change at once, because a person hidden in a
  picker but visible in a mention is not hidden, only inconsistently visible.

An older instance shows the third shape of copy, a rule living inside a middleware. In
v2.25.1 (#823) the MCP tools ran in-process past Express, and so past the only place the
module permission had been written; a member with a module set to none got its data through
that door while the REST path refused. The fix moved the verdict into a function both
surfaces call - a call, not a rebuild. Earlier still, #583 folded three verbatim copies of the
document visibility SQL into one file, and that file's header records why.

### Where the rule lives

- **Documents:** `documentVisibleSql()` and `filterVisibleDocumentIds()` in
  `server/services/document-access.js`, called from documents, dms, tasks and the document
  links every other module uses.
- **Tasks and events:** `visibilityWhere()` in `server/services/visibility.js`. **Budget:**
  `server/services/budget-visibility.js`, owner-based and without an admin bypass.
- **Module permission:** `moduleAccessVerdict()` and `deniedModules()` in
  `server/permissions.js`. The path middleware and the MCP tool layer call the same verdict,
  and a route that carries several modules sorts with `deniedModules()`, because a middleware
  that reads the path cannot know what such a route returns.
- **Widget and module id notation:** `server/services/module-capabilities.js`, where
  `fullWidgetId()` composes them and `isWidgetId()` is built from the same parts.

### What counts as undoing it

An `isAdmin` or ownership check inlined at a call site instead of the shared predicate. A
regex for a format that already has an owner. A permission rule written inside a middleware
or a guard, which binds it to that guard's construction and leaves the next surface without
it. The test that protects such a rule kills it at its home and expects every path to go red;
a test that only reads the source for the right name stays green over dead code.

---

## 3. One head, one width

**A page head holds the edge of its widest body and does not move when the view changes.**
Where the bodies of a page differ in width, the narrow ones keep their own lane underneath;
the head is not narrowed along with them.

A head that follows its body is right in exactly one view and jumps in every other. The
calendar settled this on 27 August 2026 (v2.50.3): its head stood over four bodies, three of
them full width, and once the view switcher had moved into the toolbar row the full title
line no longer fit on one line inside the 720px reading cap. The answer was not a wider cap
but a rule: the head keeps the edge of its widest body, and the agenda list keeps its reading
lane underneath.

Tasks reached the same point in #1012, reported by @Kyrodan: three views, two head widths,
and the actions on the right moved 354px on every switch at 1358px. It was the same coupling,
and Tasks had not followed when the calendar changed course. The one-line fix did not exist:
PAGE-016 requires that a measure which caps anything on a page is visible in its head, so a
reading page cannot simply release its head. The page had to be built the calendar's way
first - no measure on the root, the reading lane taken back per view on the page root, the
head untouched - and only then did the jump stop, with the task rows still ending at 720px.

### Where the rule lives

- **The construction:** `app-page--full` on the page root, and `is-reading-measure` toggled
  on that root per view (`public/pages/calendar.js`, `public/pages/tasks.js`).
  `.app-page.is-reading-measure` in `public/styles/layout.css` sets the measure, and rows and
  filter rows cap themselves at it; the head reads nothing from it.
- **The guards** in `test/test-frontend-audit.js`. "EIN Kopf, EINE Breite" recognises the
  shape by how it is written - a measure toggle on the body with no toggle on the head - and
  requires a narrowed head on the list pages it scans. PAGE-016 closes the other door: a page
  with a measured mode and a full-width head may cap nothing.
- **The mechanism** of a narrowed head, the `::after` slot that pulls the row end to the
  measure, is described in [PAGE-COMPOSITION.md](PAGE-COMPOSITION.md).

### What counts as undoing it

Toggling a head's width modifier with the view. Releasing the head of a reading page without
changing the page's mode, which PAGE-016 reports. A new page with mixed body widths that
narrows its head to the narrow body: it will be right in one view and jump in the others,
and it will be reported by whoever switches views first.
