# Intermittently failing tests

Every test that fails intermittently is a defect. The only question is where:

- **Test-side** — the test does not control a precondition, so it sometimes
  exercises the buggy path and sometimes does not.
- **Product-side** — the product is nondeterministic, so the same inputs
  sometimes produce the bug.

There is no third category. An environmental condition outside our control
(GPU compositing, runner speed) is still test-side: the test must assert or
skip on that condition explicitly rather than silently vary.

## Rules

1. **No entry may terminate at "flaky."** That word has repeatedly been used
   in this repository as a synonym for "unexplained," which is how `g-` — a
   real bug that broke the feature for every user after any file switch —
   survived for months looking like noise.
2. **Classification requires evidence.** Either a root cause, or a forced
   failure. Record observed values, not "it failed" (see
   `.agents/skills/negative-control/SKILL.md`).
3. **Forcing failure comes before fixing.** You cannot reliably force a
   failure you do not understand, so a forced failure _is_ the proof that the
   mechanism is known. N green runs never prove determinism; the 110/110 green
   run on `0815d5c` was luck, and the same commit failed twice on re-run.
4. **A fix is proven by the forcing probe going green**, not by CI passing
   once.

## Inventory

| Test                                                                       | Platform  | Observed                | Status                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g- does not crash at root`                                                | all three | 4 runs                  | **Resolved — product.** Stale `this.undoTree` captured at registration; `activateUndoTreeForFile()` swaps it per note. Fixed in `ff8442a`.                                                         |
| `zc on callout folds it`                                                   | macOS     | 3/5, then 2/3           | **Resolved — test.** The callout was still a Live Preview widget when the fold was attempted. Fixed in `7b1ea12`+. Evidence below.                                                                 |
| `editor:unfold-all clears all folds including custom`                      | macOS     | with the above          | **Resolved — test.** Same cause and same fix.                                                                                                                                                      |
| `cursor follows cursor movement`                                           | macOS     | 2 of last 3             | Unknown. Defined in `animated-cursor.e2e.ts`, which is **not** the scroll spec: an earlier note here tied it to #181 ("breaks when scrolling") on a misread filename. No established link to #181. |
| `]3 should jump to next H3`                                                | macOS     | 3/5                     | Unknown. Candidate: the same toggle race, since `beforeSuite` cycles vim before every spec.                                                                                                        |
| `the animated cursor picks up a shape change (#181)`                       | macOS     | 1                       | Unknown. Fails on its canvas-paint precondition, not on the scroll defect #181 describes.                                                                                                          |
| `focuses the expected pane in all four directions`                         | macOS     | 1                       | Unknown.                                                                                                                                                                                           |
| `"after each" hook — RPC key delegation`                                   | macOS     | 1                       | Unknown.                                                                                                                                                                                           |
| `"after each" hook — RPC structural navigation`                            | Linux     | 2/5 in CI, ~1/3 locally | Unknown. A cascade, not a cause: the session dies in the preceding test.                                                                                                                           |
| `matches counted operator-pending heading motion edits`                    | Linux     | 1                       | Unknown.                                                                                                                                                                                           |
| `matches backward operator-pending heading motion edits`                   | Linux     | 2                       | Unknown. Primary failure in the run whose afterEach then cascades.                                                                                                                                 |
| `matches the fork for operators, visual selections, registers, and counts` | Windows   | 1                       | Unknown.                                                                                                                                                                                           |
| `which-key shows after space press`                                        | Windows   | 1                       | Unknown. Polls 2000 ms for behaviour gated by `operatorshadowtimeout`'s 1000 ms deferral, so the margin is thin by construction.                                                                   |
| `a config reload closes an open picker instead of leaking it`              | Windows   | 1                       | Unknown. New in `2b6bc75`.                                                                                                                                                                         |
| `uses the host jumplist for two cross-note older jumps`                    | Windows   | 1                       | Unknown. New in `2b6bc75`; the only failure in its run.                                                                                                                                            |

## Fold pair: resolved

Live Preview renders a callout as a `.cm-embed-block.cm-callout` widget and
unrenders it to editable lines only once the cursor is inside. On a cold start
the cursor placement had not taken effect when the fold was attempted, so the
callout was still a widget, no placeholder could render inside it, and `zc`
produced nothing.

Measured, cold versus warm on the same runner and commit:

|                           | cold (fail)                          | warm (pass)                                 |
| ------------------------- | ------------------------------------ | ------------------------------------------- |
| callout / embed elements  | 1 / 1                                | 0 / 0                                       |
| third `.cm-content` child | `div.cm-embed-block.cm-callout[125]` | `div.cm-line…HyperMD-callout…cm-active[24]` |
| `.cm-foldPlaceholder`     | 0                                    | 1                                           |

`waitUntilFoldable` cannot see this: `foldable()` is a state query and returns
a range while the region is still a widget, so the precondition it checked was
not the precondition the assertion needed. `waitUntilCalloutEditable` waits for
the widget to clear.

Reproduced locally on demand, which no earlier hypothesis managed: placing the
cursor outside the callout gives `embed=1` and the widget element, placing it
inside gives `embed=0` and three `HyperMD-quote-1` lines. That is the cold
state on demand, and it also proves the new wait is not a no-op.

Classified **test-side**: a real user folds a callout with the cursor on it,
which unrenders the widget first.

## The fold pair fails on a cold start, and renders differently when it does

Two stress runs, and both failed on **iteration 1**:

|                       | iter 1 (fail) | iters 2-8 (pass) |
| --------------------- | ------------- | ---------------- |
| `.cm-foldPlaceholder` | 0             | 1                |
| `.cm-line` count      | 4             | 5                |
| content height        | 563           | 490              |
| editor height         | 598           | 598              |
| `getMode()`           | source        | source           |
| `directFoldEffect`    | stuck         | stuck            |

The fold reaches state either way. What differs is rendering: on the cold
iteration the callout occupies fewer line elements and more vertical space,
which is a decorated block rather than plain lines, and no fold placeholder
appears. Mode is `source` in both, so this is not reading view.

**This invalidates how the stress tool's rates should be read.** A shard job
in `e2e.yml` runs wdio exactly once, so every real CI job is iteration 1. A
stress run of N iterations contains one cold start and N-1 warm ones, which
is why the same spec measures ~7% under stress and ~60% in CI. Stress
underestimates any cold-start failure by roughly a factor of N.

Refuted along the way: state accumulation within the spec (`foldable` stays
true after all eight tests), and every earlier platform-difference
hypothesis, since the discriminator is warm-versus-cold on one runner rather
than macOS-versus-Linux.

The remaining question is what the callout is decorated with on a cold start.
The next probe should capture the callout element's own markup and computed
box in both states rather than aggregate counts.

## Next hypothesis for the fold pair: state within the spec

Run `35025641995` failed the fold pair again with a payload identical to every
previous one. Comparing it against the always-on probe in the same file is the
part that had not been done:

- the `before()` hook reports `directFoldEffect: "stuck"` — folding works
- `zc on callout folds it` (test 4 of 8) and `editor:unfold-all` (8 of 8)
  produce no fold at all

Folding therefore works at the start of the spec and stops working later in
the same file, on the same runner, in the same process. That is state
accumulating across tests, not a property of the platform — and it is
consistent with every refuted hypothesis so far, all of which looked for a
macOS-versus-Linux difference.

A probe must record foldability after **each** test in `fold-providers`, on a
runner where it fails, and find the first test after which it stops. All eight
pass locally, so this needs CI or a forced local equivalent of whatever that
test leaves behind.

## Canvas entries are intermittent, confirmed

`cursor follows cursor movement` passed on macOS in `35008278154` and failed
on macOS in `35025641995`, with no code change between them affecting it. It
is intermittent on that runner rather than impossible there.

## RPC entries after the connection timeout

Two consecutive runs (`35008278154`, `35025641995`) contain no RPC failures,
against three of five before `9fda566`. Encouraging and far from proven; the
prior green run `0815d5c` was followed by two red ones on the same commit.

## Runner capability, measured

|                    | Linux       | macOS    | Windows     |
| ------------------ | ----------- | -------- | ----------- |
| cores              | 4           | 3        | 4           |
| device memory      | 8 GB        | 8 GB     | 8 GB        |
| WebGL              | SwiftShader | **none** | SwiftShader |
| `directFoldEffect` | stuck       | stuck    | stuck       |

macOS is the only runner with no WebGL context, and the only one where the
canvas entries fail. That is suggestive, but it is **not** a capability wall:
`9fda566` added `canvasPaintSupported`, which skips a canvas spec when 2D
paint and readback are unavailable, and across 36 macOS jobs in run
`35008278154` it never fired. Both canvas tests ran and passed there.

So the canvas entries are intermittent on macOS, not impossible on macOS, and
"a runner artifact that cannot affect real users" is **not** established.

Note the guard checks an offscreen 2D readback, which is weaker than what the
feature needs (an onscreen composited canvas). It not firing rules out the
strongest form of incapability, not every form.

Fold works on all three runners, so no graphics explanation applies to it.

## Do the entries share a cause?

Two structural factors were checked and neither discriminates:

- **Position in the spec file.** Spread evenly (4/8, 8/8, 4/7, 11/16, 2/2,
  11/29, 10/14, 5/14, 1/1, 2/12, 7/10, 24/29), so this is not per-spec setup
  hitting the first tests.
- **Synchronisation style.** `zc on callout folds it` has seven `browser.pause`
  calls and four `waitUntil`s and fails; `which-key`, the operator-pending pair
  and the jumplist entry have none of either and fail too.

What does partition cleanly is the subsystem each one waits on, and it
correlates with platform:

| Cluster         | Entries                                        | Asserts on                                  | Platform         |
| --------------- | ---------------------------------------------- | ------------------------------------------- | ---------------- |
| Rendering/paint | fold pair, animated cursor pair                | CM6 decorations, canvas pixels              | all macOS        |
| RPC lifecycle   | structural-nav pair, text-objects, bridge pair | cross-process parity; two are hook failures | Linux-dominant   |
| UI lifecycle    | which-key, picker leak, pane focus             | transient overlay, modal, focus             | Windows-dominant |

Every entry asserts on state an asynchronous subsystem must produce in
reaction to an event, never on synchronous in-memory state. That is necessary
but not sufficient — most passing e2e tests do the same.

The clustering argues against a single root cause. Treat the three groups as
three investigations, and force each at the conditions its own cluster runs
under.

## Two runs of one commit share no failures

`2b6bc75` was run twice with no code change between them:

| Run A                                                                   | Run B                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `"after each" hook — RPC structural navigation` (Linux)                 | —                                                                 |
| `matches backward operator-pending heading motion edits` (Linux)        | —                                                                 |
| `zc on callout folds it` (macOS)                                        | —                                                                 |
| `editor:unfold-all clears all folds including custom` (macOS)           | —                                                                 |
| `a config reload closes an open picker instead of leaking it` (Windows) | —                                                                 |
| —                                                                       | `uses the host jumplist for two cross-note older jumps` (Windows) |

The sets are disjoint. Whatever selects the failures on a given run, it is not
the commit, so a single green run says nothing and a single red one identifies
only which test drew the short straw that time.

Measured across the five runs containing `34168dd`: the fold pair failed in
three and the RPC structural-nav pair in three, both matching their pre-fix
rates. That is the basis for saying the toggle fix did not touch them.

## Shard numbers do not identify specs

`e2e (macos-latest, shard 3)` reported `cursor follows cursor movement`, but
that test is defined in `animated-cursor.e2e.ts`, which the same round-robin
places in shard 1; shard 3 holds `animated-cursor-scroll.e2e.ts`, which does
not define it. Recomputing the discover job's distribution locally therefore
does **not** reliably reproduce the mapping a given run used.

Read the failing test name from the job log or the step summary. Do not infer
the spec from the shard index, and do not infer a root cause from the spec you
think the shard contains — that is how the #181 attribution above was made.

## Fold providers lost by the vim-mode toggle

Refuted first, so they are not re-tested:

| Hypothesis                       | Measurement                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Key delivery                     | `viaCommand: true, foldedAfterCommand: false` — folding fails through Obsidian's own `editor:toggle-fold` too |
| Degenerate provider range        | `range {from:39,to:88}`, `degenerate: false`                                                                  |
| Viewport too small to parse      | `viewport {from:0,to:106}` over a 106-character document, `viewportCoversLine: true`                          |
| Fold applied but not detected    | `foldedRanges: []`, `placeholders: 0`                                                                         |
| CM6 folding unavailable on macOS | `directFoldEffect: "stuck"` on all three platforms                                                            |
| Obsidian version                 | 1.13.7 on macOS and Linux alike                                                                               |
| Window size                      | 8/8 folds at 1024x676 (macOS CI), 1274x984 (Linux CI), 2538x1380                                              |
| Runner slowness                  | 40/40 folds at CPU throttle 1x, 4x, 8x, 16x, 32x                                                              |

Forced by replaying what `wdio.conf.mts` does before **every** spec — disable
vim, pause, enable vim, pause:

```
pause 800ms -> 6/6 folded (FFFFFF)
pause 200ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause  50ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause   0ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
```

`foldableMisses` equals the failure count exactly: when it fails,
`foldable()` returns null, so `zc` correctly folds nothing. Isolating the
toggle from the editing:

```
baselineFoldable: true -> afterEachCycle: "FFFFFFFF" -> afterSettle3s: false
```

Folding does not recover. A user who toggles vim mode loses folding until
Obsidian reloads.

### Mechanism, as far as it is established

```
disable0 -> vimEnabled false
enable0  -> false            <- fails when it follows a real disable
settled0 -> false, foldable false
disable1 -> false (no-op)
enable1  -> true,  foldable true   <- succeeds when it follows a no-op
```

`enableVim` fails only when it follows a _real_ disable, so `disableVim()`
resolves before its teardown has finished: there is un-awaited async work
continuing past the returned promise, and the enable races it.

Two fixes were attempted and **both proven insufficient**, so neither shipped:

1. Serialising toggles through a promise chain — `FFFFFFFF`, unchanged.
   Serialising on a promise that settles too early cannot help.
2. Deferring the `settings.vimEnabled` check out of the command callbacks —
   `FFFFFFFF`, unchanged. It does fix a real secondary defect
   (`enable-vim-mode` reads the flag synchronously, so with a disable pending
   the enable was never queued at all), but not this.

### The toggle defect is real but is not this cause

`34168dd` fixed a genuine, user-facing bug: a rapid disable/enable left Vim
off and every extension-slot feature unregistered until Obsidian reloaded.
Forced deterministically before the fix, `TTTTTTTT` after it.

It did **not** fix the fold failures. `zc on callout folds it` and
`editor:unfold-all` failed again in `953c8e6` and `4b688c6`, both of which
contain the fix, at roughly the pre-fix rate.

The error was an inference, not a measurement. The forced reproduction used a
**0 ms** gap between disable and enable; at the **800 ms** gap `wdio.conf.mts`
actually uses, the _unfixed_ code folded 6/6. Claiming CI was affected
required assuming a slow macOS runner makes 800 ms behave like 0 ms, which
was never measured and is now refuted.

The fold cause is therefore still unknown, and this is the eleventh refuted
hypothesis for it. Anything proposed next must be forced at the gap CI
actually uses.

### Toggle fix detail (`34168dd`)

Both `disableVim` and `enableVim` cleared `toggleInProgress` from a 500 ms
timer armed in `finally`, so the returned promise resolved while the flag was
still set. The opposite toggle, arriving inside that window, hit its own guard
and was discarded with nothing to retry it.

Three changes were needed, and each was individually insufficient:

1. **Await the cooldown** before clearing the flag, so the promise reflects
   completion. The chain alone still resolved into the window.
2. **Serialise toggles** through a promise chain, so the next starts after the
   previous finishes.
3. **Defer the `settings.vimEnabled` check** out of the command callbacks.
   Reading it synchronously made `enable-vim-mode` skip queueing a toggle whose
   predecessor had not yet updated the flag, so the guard was never reached.

The probe now reports `afterEachCycle: "TTTTTTTT"` with `vimEnabled: true`.

`vim-toggle.e2e.ts`'s `rapid toggle is debounced` asserted `vimEnabled` false
after a rapid disable/enable — the dropped request, encoded as intent. It now
asserts the state that was asked for. This is a deliberate behaviour change:
a rapid double toggle applies both halves instead of swallowing the second. If
the debounce was guarding against real thrash, the better design is coalescing
(record the desired end state, apply once) rather than applying both.

### Every extension-slot feature was exposed

`setupVimSubsystems()` nests the per-feature slots inside the one the toggle
emptied — `animatedCursorSlot` (`src/main.ts:2831`), `undoTreeSlot` (:2746)
and the three snippet slots (:2785-2787). A dropped enable therefore took all
of them down together, not folding alone.

That makes one mechanism a candidate for several entries above, including
both animated-cursor entries, whose CI signature is a canvas that never
paints. **Not yet confirmed by measurement.** Two probe attempts failed on their own
preconditions rather than on the subject:

1. `setPluginSetting` stores the value without reloading features, giving
   `canvases: 0` at baseline. Use `setPluginSettingAndReload`.
2. With that fixed, `canvases: 1` but `painted: false` _at baseline_, before
   any toggling — the canvas is sampled once after 500 ms, while the real
   assertion polls up to 5.4 s (`pollPaintedCursor`). A single sample is too
   early to mean anything.

A valid probe must reuse the spec's own polling helper rather than a
point-in-time read. Until then this remains a source-level observation.

### Why this may not be only about folding

`wdio.conf.mts` cycles vim mode before every spec, and `AGENTS.md` records
that `animatedCursor`, `enableSnippets`, `snippetTriggerMode` and
`enableUndoTree` all shipped broken for want of a runtime slot. Any
extension-slot feature is exposed to the same teardown race, so this one cause
may account for several macOS entries above. Test them against this lever
before investigating them separately — `34168dd` may already have cleared
some of them, which the next CI run will show.
