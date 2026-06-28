# Project conventions for Claude

Adapted from the `../movies` conventions for this project's stack: Node ≥24
(ESM), `node --test` unit + integration suites, Playwright e2e, SQLite +
Litestream → Cloudflare R2, OAuth, deployed on Render (service `filmowo`,
fronted by Cloudflare). External data from Movie of the Night (MotN) and
Criticker.

## Always add tests for new or changed functionality — the commit gate

Do not commit a change unless you can write a test that **fails before the
change and passes after**. If no such test can be written, the change isn't
ready. This is a gate, not a suggestion.

"Test" means whichever layer reaches the behaviour:

- **`npm run test:unit`** (`test/unit/**/*.test.js`) — pure logic: scoring,
  filtering, normalisation, decision functions, model code.
- **`npm run test:integration`** (`test/integration/**/*.test.js`) — wiring
  across the server, DB/repository, and external-client seams with fakes.
- **`npm run test:e2e`** (Playwright, `e2e/*.spec.js`) — any visible UX
  change: onboarding, ratings, settings, nav, card layout, gates. A visible
  change shipped without a browser test has NOT met the gate ("it's UI, I
  can't unit-test it" → drop to Playwright and assert there, e.g. on
  `getBoundingClientRect()`).

Run **every** layer the change touches locally before reporting it done; run
independent layers in parallel (separate Bash calls in one message). CI is the
safety net, not the test plan. Default to writing the failing test first.

For external-API clients (MotN, Criticker), record a real response as a fixture
under `test/` and replay it through the client — no live HTTP in tests. MotN's
free tier is only 500 req/month, so a captured fixture is also quota you don't
spend. (See also the standing `update-tests-with-changes` convention.)

## Git, worktrees, and committing

- **Work in your own worktree, never the root `main` checkout** — the root is
  for orchestration/inspection only (`work-on-worktrees`).
- **Never finish a turn with a dirty tree you own.** Commit (preferred) or
  stash with a descriptive label. A bare, unlabelled dirty tree is the failure
  mode. Touch only files that are yours.
- **Commit at every stable state** — production code done, tests written and
  passing, no leftover errors. Each commit is a checkpoint you'd revert to.
  Commit messages describe the *why* in one or two sentences (the diff shows
  the what). Never amend a published commit.
- **Auto-commit, push, and deploy once a change is the natural end of the
  asked-for work** — don't sit in a "want me to commit?" prompt. Integrate via
  local `main` and push `main` to origin (`integrate-via-local-main`); Render
  deploys on push (`push-deploy-on-feature-complete`).
- **Stop and ask only when something can't be cheaply undone:** force-pushes /
  rewriting published history, destructive data ops (dropping tables, wiping
  the R2 replica), or staging anything that smells like a secret. Stage secrets
  never; `.env.local` is gitignored.

## Cleanup is a phase of every task; audit what each change displaced

The work isn't done when the new code passes — it's done when the area is at
least as clean as you found it. In the same change:

- **Extract repeated multi-line shapes at the *second* use** — a fake set up
  inside every test, the same regex/normalise chain in two places, a
  "load fixture and feed the client" helper. Name after the concept; delete the
  inline copies in the same commit.
- **Delete what the change made obsolete** — a fallback branch the new path
  replaced, a now-single-caller helper, a config flag whose off-branch is
  unreachable, a test for behaviour that no longer exists, a stale comment, an
  unused import.
- **Walk the call graph proactively** after the change is functionally done:
  *what did this just make redundant?* Delete obvious redundancy in the same
  commit; surface debatable wider removals ("X is now dead — remove in a
  follow-up?") rather than silently leaving them.

Cleanup may reach beyond the file you touched — every file you read is fair
game. Split a large cleanup into its own commit so the feature diff stays
reviewable.

## Follow SOLID; share logic between real and fake implementations

Depend on **abstractions, not concrete classes** — the load-bearing principle
here. High-level modules take an interface/contract through their constructor;
the concrete choice (real DB vs in-memory, real HTTP client vs replayed
fixture) is wired at the composition root. Tests swap in the fake via that same
seam — production code never references a test double directly.

- Single responsibility: if you can't name a module without "and", split it.
  Avoid catch-all names (`Manager`, `Handler`, `Util`).
- Open/closed: add a new variant (a new ratings source, a new provider) as a
  new implementation of the existing contract, not by editing a `switch`.
- **Never suffix a class/module `Impl`.** Name after what makes it distinct —
  `InMemoryRatingsStore` / `SqliteRatingsStore`, not `RatingsStoreImpl`. If
  there's only one implementation and a trait feels awkward, you don't need the
  trait yet — collapse it until a second one appears.
- **Don't duplicate business logic across a real and a fake.** Draw the seam so
  the rules live in shared code and the two differ only at the infrastructure
  boundary (where data is stored, which backend is called, what clock ticks). A
  fake that re-implements a merge/sort/filter rule lets tests pass while real
  code is broken. A good fake is boring: a `Map`, a fixed list of responses, a
  fixed clock.

## Parallelize external-API work, but don't get rate-limited

Scripts that hit external services (MotN, Criticker) should do per-row work in
parallel — serial loops of hundreds of network round-trips are unacceptably
slow. Default to a fixed pool of **5–10 concurrent workers** against a single
API, and stay well under each limit:

- **MotN free tier: 500 requests / *month*.** This is the binding constraint —
  cache hard, call only on demand, prefer fixtures in tests. Never burn it in a
  loop "to be safe" (`motn-rate-limit`).
- Criticker / others: undocumented; 5–10 workers, back off on any 429/503.

On 429/503, halve concurrency and add a small sleep before retry — the host is
telling you to stop. Print throughput at the end (`done in 12.3s, ~8 req/s`).

## Don't iterate on transient errors

If a tool call fails with something that smells like a build/cache/race/infra
problem — `No tests found`, `EBUSY`, `ENOENT` on a file you just wrote, a
module-resolution error in a known-good setup, a Playwright loader error from a
project that ran a minute ago — **retry once cleanly before iterating.** Each
variation produces a new shape of the same noise, not new signal.

The cheap probe: nuke the suspect state (`rm -rf test-results/`,
`pkill -f playwright`, clear the relevant cache) and rerun the **original**
command. Reproduces → real bug; doesn't → it was flaky, and a test that only
passes on rerun is unhealthy, fix it (`build-robustness`). Real assertion
failures name an expectation, value, and location; transients say "the runner
couldn't start" or "the filesystem disagrees with what I wrote a second ago".

## Quota-saving patterns

- **Batch independent tool calls in one message** — `git status`, `git diff`,
  `git log` have no dependencies; fire them together. Same for unrelated reads.
- **Background long waits** (`gh run watch`, deploy polls) with
  `run_in_background: true` and trust the completion notification — don't
  poll-loop in the foreground, and don't sleep+poll on top of a backgrounded
  wait.
- **Run the narrowest test scope you can** while iterating — `node --test` on a
  single file, `playwright test e2e/ratings.spec.js`, not the whole suite.
- **Don't re-read a file after a successful Edit/Write** — the harness tracks
  its state.
- **Delegate broad read-only exploration** ("where is X used", "how does Y wire
  together", reading dozens of log lines) to an `Explore` or Haiku-backed
  subagent and act on its summary — don't burn main-context tokens on probe
  sprees.
