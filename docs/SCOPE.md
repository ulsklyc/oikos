# What Yuvomi will not become

Yuvomi is maintained by one person, and every integration in the core is a promise without
an end date. Saying no to the right things is what keeps the rest working. This page collects
the boundaries that come up again and again, so that a request does not have to be argued
from scratch every time - and so that a "no" arrives with a reason and with the condition
under which it would become a "yes".

Three kinds of answer live here:

- **Not this way.** The goal is right, the proposed route is not. There is usually another
  route on this page.
- **Not here.** It belongs next to Yuvomi rather than inside it - as a third-party module
  against an unmodified image. See [MODULES.md](../MODULES.md).
- **Not at all.** Exactly two things, in the whole project: multi-tenancy (#611) and parcel
  tracking (#378).

Anything not listed here is simply not built yet. That is not the same as declined, and
the [backlog](../BACKLOG.md) is where those live. Decisions about *how* something inside the
scope is built, made once so they are not argued again, live in [DECISIONS.md](DECISIONS.md).

---

## 1. Bank connections and other finance apps' data

**Yuvomi does not connect to your bank, and does not adopt another finance app's data
engine.** Neither is a matter of effort; both are a matter of shape.

### Live bank access is licensed, and the licence assumes a company

Reading account data means going through PSD2 / open banking, and that access is licensed:
either the software provider holds an AISP licence, or it runs through an aggregator -
GoCardless Bank Account Data, Plaid, Akahu, Enable Banking and friends. The licence does
assume **one company running one service for many users**, and Yuvomi is the opposite
shape: everybody runs their own instance and there is no server of ours in the middle, so
there is no set of credentials that could ship with the app.

What that does *not* mean is that it is out of reach for an individual, and it is worth not
overstating this. Several aggregators answer exactly this case with a restricted personal
mode - Enable Banking's Restricted Production is free for private use, self-serve, and runs
under *their* licence against accounts you link yourself; Firefly III documents an import
built on it. So the obstacle is not the licence, it is that **every household would have to
register its own application and link its own accounts**, and that each provider covers one
region - Europe here, Akahu in New Zealand, Plaid elsewhere - so the core would collect one
integration per region and maintain them all. That is the argument in section 2, and the
answer is the same: this belongs in a sidecar, where #746 already does bank feeds. (#776)

### Another app's sync engine is a second data runtime

Actual Budget is the recurring example, and a fair one: it answers a different question
than Yuvomi's Budget module does, and sitting next to it is sensible. But Actual has no
ordinary HTTP API. Integrations go through `@actual-app/api`, a Node package that opens the
**local** budget file and runs Actual's own sync engine alongside Yuvomi. That means a
second data runtime next to a synchronous `better-sqlite3` backend, two sources of truth
with the migration and conflict handling that implies, and a release cycle where their
breaking change becomes a broken module here. (#834, #563)

Not every finance app is this case, and it is worth not over-claiming. Wallet by
BudgetBakers, for instance, issues per-user personal access tokens against an ordinary REST
API (#959) - no licence, no aggregator, nothing that assumes a company in the middle. What
keeps that one out of the core is the argument in section 2 rather than this one: it is a
paid tier of somebody else's product, and it would be a permanent commitment to one vendor
among many.

### The open door: the file your bank already gives you

The route that fits is the one that needs no licence, no aggregator, no recurring cost, and
that works for every bank rather than the subset an aggregator covers: **import the export
file your bank hands you**, with a column mapping you set once. Its shape was settled in
#866 and is tracked as #1000:

- **A mapping is saved and shareable - Yuvomi ships no bank list.** This is about
  maintenance, not comfort. If Yuvomi ships bank profiles, every missing bank is an issue
  against Yuvomi and that queue never ends. If a mapping is something you save after your
  first import and can export, a community repository is people helping each other and
  Yuvomi stays out of it. Same benefit, none of the ownership.
- **A saved mapping keys on the header row**, since that is what identifies the format
  anyway.
- **Duplicates** are caught by a fingerprint over the fields you choose, hashed when there
  are several, and **stored per entry** rather than recomputed at import time - otherwise
  changing the mapping later silently makes every past import look new.
- **Categories stay empty**, with an optional column mapping for banks that export one.
  Any automatic assignment needs a list of merchants, and that list is wrong the moment
  somebody shops somewhere else.
- **CSV first.** JSON only if an export turns up that is genuinely unavailable as CSV: the
  mapping step asks which *column* means what, and JSON has no columns, it has nesting -
  that is a path expression and a different feature. OFX stays out for its own reason, that
  a half-implementation of a bank format is worse than none.
- **The acceptance test needs no bank:** Yuvomi must read back what
  `GET /api/v1/budget/export` writes, with no mapping and no configuration.

### If you want live bank data today

That is what a sidecar is for. @JakeTheRabbit built exactly this against an unmodified
Yuvomi image - encrypted token storage, a scheduler and a bank API, talking to Yuvomi
through `/api/v1` and the `modules/` directory, without patching the core or writing to the
database. See #746 and [MODULES.md](../MODULES.md).

---

## 2. Integrations with other people's services

**Yuvomi does not take on a permanent binding to somebody else's cloud in the core.** Every
such integration brings a token store, a scheduler, an auth flow, rate limits and a
breaking change somebody else decides on - and once it exists, keeping it alive is a
commitment without an end date for a project one person maintains.

The other half of the reason is that a provider is always *somebody's*. The household in
the Google and Fitbit ecosystem, the one on Apple Health and the next one on something else
each need their own integration. Two hard-coded providers serve two households; a documented
API and a scoped token serve all of them.

### The shape that works: Yuvomi stays the server, the bridge is a client

The API token system has per-area scopes, so a bridge can be granted exactly the endpoints
it needs and nothing else. Every provider then becomes somebody's small tool rather than a
permanent fixture in this repository.

**This is a route, not a brush-off.** @JakeTheRabbit built a sidecar platform against an
*unmodified* Yuvomi image - encrypted token storage, a scheduler and a bank API, all through
`/api/v1` and the `modules/` directory, with no core patch and no second writer on
`yuvomi.db` (#746). Since v2.63.0 a third-party module also has the same surfaces a core
module has - widgets, `ext:<module-id>` permissions, an API prefix, a locale chain - and
declares which manifest format it is written in, so the format can move without silently
breaking modules nobody here can see (#919).

**What is promised, and what is not.** `/api/v1` and the public browser libraries are the
contract, and breaking changes to them are called out in the CHANGELOG. Direct database
access, private helpers under `server/` and undocumented response fields sit outside that
line and may change in any release. Nothing gates loading on a compatibility range either,
so a module calling an endpoint a later release moved keeps loading and fails in front of
the user - [MODULES.md](../MODULES.md) describes how to check for that and how to degrade.

**The known gap, stated rather than hidden:** the API is read and write, not a change feed.
Pushing data in works today; anything that wants to *stay* in sync has to poll and diff, and
deletions cannot be learned at all. Tracked as #1002.

### Where the line falls in practice

- **Health providers** - Google Takeout / Health Connect / Fitbit (#743) and Apple Health
  (#639) both sit outside the core and are supported by the API. Worth being honest about
  the Apple half: a HealthKit bridge has to run on Apple's platform and keep working across
  iOS releases, so living outside this repository moves that maintenance rather than
  removing it.
- **Another finance app's cloud** - Wallet by BudgetBakers (#959) is the worked example.
  Its REST API takes a personal token per user, so a sidecar holding that token is a route
  that works today, and the Akahu plugin in #746 is the same shape. Both that API and
  Wallet's own CSV export are Premium features, which is the other half of why this does not
  belong in the core: a built-in feature that only works for one commercial app's
  subscribers.
- **A password vault** (#947) is not a sidecar case, it is out of the app entirely. A
  credible vault needs zero-knowledge encryption, a key hierarchy that survives password
  resets, audited crypto and a threat model for every place a secret is shown - and half of
  that is worse than none. Vaultwarden runs happily on the same box and does organisation
  sharing properly. What does fit is the metadata *without* the secret: which account,
  whose it is, and where the password actually lives. A username without its password is a
  phone-book entry.
- **A product database with nutrition and package sizes** (#714) is declined, and the
  precise reason matters because the first one given was wrong. Not privacy - the reporter
  correctly pointed out you can type nutrition off the packaging, no outside server
  involved. The reason is that a field only earns its place if it stays true without
  anybody tending it. A price is a fact about a purchase and stays true forever; nutrition
  is a fact about a *product*, and manufacturers change recipes and package sizes. Yuvomi
  would be asking a family to hand-maintain a product catalogue, and a half-filled table
  that looks like an answer is worse than no table. The price on a shopping item is the
  part that fits, and that part is wanted.

---

## 3. Dependencies

The rule is often stated as "Yuvomi has no dependencies". That is not true, and stating it
that way has cost more than one request a proper answer. What is true splits in two:

- **In the browser: no runtime dependencies, and this half is absolute.** Not because
  third-party code is bad, but because there is no build step. A browser dependency would
  have to arrive either through a bundler or from a CDN at runtime, and both are excluded
  permanently. Third-party frontend code enters by hand instead: copied into
  `public/vendor/`, committed, with its license and its update steps written down. That
  path is open and it is used.
- **On the server: small, deliberate, and emphatically not zero.** See `package.json` for
  the current list - it is all infrastructure, and it is chosen rather than accumulated.

@aizaimosaou put the better formulation in #642: not "no dependencies", but *"only small,
well-audited dependencies with a clear purpose"*. That is accurate, and it is already what
the backend does. Writing every specialist domain in-house would make Yuvomi the maintainer
of leap-month rules, per-country phone formats and PDF rendering, which is worse than
depending on the people who do that for a living. `libphonenumber` is exactly that trade,
already made, and vendored on both sides.

So a proposal does not have to argue that a dependency is permitted. It has to answer four
questions:

1. **Would writing it ourselves make Yuvomi the maintainer of a specialist domain?** If
   yes, a vendored library is usually the cheaper long-term answer, not the more expensive
   one.
2. **Does it run in the browser?** Then it is hand-copied into `public/vendor/` with its
   license and update steps, or it does not happen.
3. **Does it need the network at runtime?** Then it is the CDN rule wearing a different
   coat, whoever is hosting the endpoint. "Just fetch today's value once a day" is the
   usual shape this takes, and it is a no for the same reason as the rest.
4. **Does it earn a permanent place now, or is it an abstraction for a future that has not
   arrived?** A provider layer with one implementation is a guess.

### The two cases that produced this rule

- **#642, non-Gregorian birthdays.** This one is in the list as a warning, because the
  dependency question was answered before it was asked. Converting a lunar date looks like
  it needs vendored astronomical data - and it needs nothing at all: `Intl.DateTimeFormat`
  with `-u-ca-chinese` does it from the ICU data the runtime already carries, in Node and
  in the browser, with leap months preserved (`6bis`, not `6`), and `dangi`, `islamic` and
  `hebrew` come along with it. The reverse direction is a short search using the same API.
  Before question 1 gets asked, it is worth asking whether the platform already answers it.
  What remains is product design: which calendar a birthday is stored in, and what a
  birthday in a leap month does in a year that has no such month.
- **#656, filling forms from free text.** Here the dependency question mostly dissolves:
  the deterministic tier needs no library, and a local model speaks HTTP, so it needs no
  SDK either. What remains is question 4 and one thing that is not about dependencies at
  all - a hosted-API tier sends appointment titles, health notes and shopping habits to a
  third party. In an app whose whole promise is that nothing leaves the machine, that
  cannot be a setting somebody switches on without understanding it, however clearly it is
  labelled opt-in.
