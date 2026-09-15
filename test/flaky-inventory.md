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

| Test                                                                       | Platform  | Observed                | Status                                                                                                                                                    |
| -------------------------------------------------------------------------- | --------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g- does not crash at root`                                                | all three | 4 runs                  | **Resolved — product.** Stale `this.undoTree` captured at registration; `activateUndoTreeForFile()` swaps it per note. Fixed in `ff8442a`.                |
| `zc on callout folds it`                                                   | macOS     | 3/5, then 2/3           | **Product.** Vim-mode toggle leaves fold providers unregistered. Evidence below.                                                                          |
| `editor:unfold-all clears all folds including custom`                      | macOS     | with the above          | **Product.** Same cause; fails in the same runs.                                                                                                          |
| `cursor follows cursor movement`                                           | macOS     | 2 of last 3             | Unknown. Lives in `animated-cursor-scroll.e2e.ts`; issue #181 is "Animated Cursor breaks when scrolling", so a real product bug is the leading candidate. |
| `]3 should jump to next H3`                                                | macOS     | 3/5                     | Unknown. Candidate: the same toggle race, since `beforeSuite` cycles vim before every spec.                                                               |
| `the animated cursor picks up a shape change (#181)`                       | macOS     | 1                       | Unknown. Fails on its canvas-paint precondition, not on the scroll defect #181 describes.                                                                 |
| `focuses the expected pane in all four directions`                         | macOS     | 1                       | Unknown.                                                                                                                                                  |
| `"after each" hook — RPC key delegation`                                   | macOS     | 1                       | Unknown.                                                                                                                                                  |
| `"after each" hook — RPC structural navigation`                            | Linux     | 2/5 in CI, ~1/3 locally | Unknown. A cascade, not a cause: the session dies in the preceding test.                                                                                  |
| `matches counted operator-pending heading motion edits`                    | Linux     | 1                       | Unknown.                                                                                                                                                  |
| `matches backward operator-pending heading motion edits`                   | Linux     | 2                       | Unknown. Primary failure in the run whose afterEach then cascades.                                                                                        |
| `matches the fork for operators, visual selections, registers, and counts` | Windows   | 1                       | Unknown.                                                                                                                                                  |
| `which-key shows after space press`                                        | Windows   | 1                       | Unknown. Polls 2000 ms for behaviour gated by `operatorshadowtimeout`'s 1000 ms deferral, so the margin is thin by construction.                          |

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

The fix is to make `disableVim` await its complete teardown. It is proven when
the probe above reports `afterEachCycle: "TTTTTTTT"`.

### Why this may not be only about folding

`wdio.conf.mts` cycles vim mode before every spec, and `AGENTS.md` records
that `animatedCursor`, `enableSnippets`, `snippetTriggerMode` and
`enableUndoTree` all shipped broken for want of a runtime slot. Any
extension-slot feature is exposed to the same teardown race, so this one cause
may account for several macOS entries above. Test them against this lever
before investigating them separately.
