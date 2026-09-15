# Halftone overlay

The logged-out landing page is screened by a halftone effect: the page is
captured to a bitmap, re-rendered as a grayscale line screen, and composited
back over itself with `mix-blend-mode: soft-light`.

| Where                                       | What                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `src/lib/halftone.ts`                       | The model: a CPU reference renderer plus the GLSL source generated from it |
| `src/lib/components/HalftoneOverlay.svelte` | Capture, WebGL setup, the rAF loop, the fade-in                            |
| `src/lib/halftone.test.ts`                  | Regressions against the Affinity reference exports                         |
| `src/lib/testing/halftone-fixtures/`        | Those exports, one directory per thing being calibrated                    |
| `e2e/landing.spec.ts`                       | The only level that runs the real shader in a real browser                 |

The target is the **Halftone filter in Affinity by Canva**, in line-screen
mode. The whole filter was reverse-engineered from the fixtures below and
turned out to be four lines of arithmetic; the previous implementation was a
hand-fitted pile of spline constants that matched nothing in particular.

## The model

```
tone   = 0.299·R + 0.587·G + 0.114·B
coord  = (x − cx)·sin θ + (y − cy)·cos θ
screen = triangle(coord / cellSize)                    // 0..1, 0 at the cell centre
out    = clamp01( tone + tan(π/2 · contrast) · (screen − (1 − tone)) )
```

Each part is pinned by a specific reference, and each is worth stating because
the plausible alternative is wrong:

- **Rec.601 luma on sRGB values, not linearised.** The contrast-0 export is the
  filter's grayscale pass with the screen switched off, and it turns solid
  `#FFC621` into 196/255. Rec.601 gives 196.2; Rec.709 gives 198.2, the channel
  mean gives 162, and a linear-light round trip gives 211.

- **The screen is a symmetric triangle, not a sine.** A triangle wave is
  uniformly distributed, so thresholding it at `1 − tone` inks exactly `1 − tone`
  of the area: the screen reproduces tone linearly. The contrast-100 export
  confirms it directly — a 0.7695 tone leaves an 18 px black band in each 80 px
  cell, and 80 · (1 − 0.7695) = 18.4.

- **Phase zero is the image centre.** In the 500 px contrast strip the troughs
  land on rows 9.5 + 80k, and 249.5 is one of them.

- **Angle is measured from horizontal with y running down.** At 0° the lines are
  horizontal. The shader has to mirror y because `gl_FragCoord.y` runs up; it
  gets away with flipping only the sine term because the triangle is even.

- **Contrast is the tangent slope law.** Measuring the screen's slope in the
  cell-80 sweep gives 0.4165, 0.9945 and 2.431 at contrast 25, 50 and 75 —
  tan(22.5°), tan(45°) and tan(67.5°) to within a quantisation step. Contrast 0
  collapses to a plain grayscale pass and contrast 100 to a hard threshold, so
  the ends need no special case (the slope is only capped at 1e6 to keep the
  shader's float finite).

- **The pivot is the ink threshold.** Whatever the contrast, the output equals
  the tone at the point where the screen crosses `1 − tone`, which is why every
  curve in the sweep passes through the same two rows of each cell.

- **Tone is read per pixel — there is no pre-blur.** This is the one worth
  repeating, because pre-blurring along the screen axis is the intuitive thing
  to do and a previous version did it. Removing it is most of what took the
  33.6 px references from visibly wrong to 1.6/255 RMSE.

Grain is a separate control, applied after the screen: a monochrome triangular
deviation of ±40/255 at full strength, added equally to all three channels.
Triangular because at 50% strength the reference grain spans exactly ±20/255
with a standard deviation of 8.12/255, and 20/√6 = 8.16.

The hash behind it has one non-obvious constraint: **it has to be white in
float32, not just in float64.** The usual `fract(sin(dot(p, k)) * 43758.5453)`
is not — by the time `p` is a full-page fragment coordinate the argument to
`sin` is around 150000 radians, and on the GPU that loses most of its mantissa.
Measured against the real WebGL context in Chromium it gave grain with a
standard deviation of 44/255 instead of 52/255, with visible vertical streaks,
while the same code in Node looked perfect. The hash in use instead mixes by
multiplication only, keeping every intermediate under 100 so float32 holds it
exactly; it measures 52.15/255 with autocorrelation under 0.006 at every lag on
both paths. `halftone.test.ts` asserts that whiteness directly, because a
distribution check alone passes a structured hash.

Strengths above 1 are allowed and just scale the deviation, but be aware they
interact with the screen's clipping: once the grain is wide enough to push the
troughs below 0 and the crests past 1, it only survives in the middle of each
band and starts to read as the band pattern rather than as grain.

The `circle` pattern has no Affinity reference. It reuses the same screen and
contrast law with `coord` as the radius from the centre.

### What is deliberately not reproduced

Affinity's screen picks up a linear offset within roughly a cell of the canvas
edge. It is the screen and not the tone that moves there: solving the model for
a screen offset gives the same number at every contrast level, while solving it
for a tone change does not. That is an artefact of a filter running on a bounded
canvas, and the overlay covers a whole viewport, so the tests exclude a border
margin rather than the code imitating it.

## The fixtures

`src/lib/testing/halftone-fixtures/`. Every directory pairs an unfiltered
source with one or more filtered exports. **These settings are the only record
of how each file was produced — keep this table current when adding one.**

| Directory     | Source                        | Output(s)                                 | Filter settings                                                                       |
| ------------- | ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `shape-2/`    | `without-halftone-filter.png` | `with-halftone-filter-{0,15,45}-deg.png`  | Line, cell size **33.6**, contrast **75**, angle **0 / 15 / 45°** per filename        |
| `shape/`      | `without-halftone-filter.png` | `with-halftone-filter.png`                | Line, cell size **50**, contrast **50**, angle **0**                                  |
| `soft-light/` | `without-halftone-filter.png` | `with-halftone-filter-and-soft-light.png` | As `shape/`, **plus** the page's soft-light blend                                     |
| `contrast/`   | `no-filter.png`               | `filter-{0,25,50,75,100}-contrast.png`    | Line, cell size **80**, angle **0**, contrast **0 / 25 / 50 / 75 / 100** per filename |
| `noise/`      | `no-noise.png`                | `50-percent-noise.png`                    | Noise **50** only — no halftone filter                                                |

No soft-light blend and no grain anywhere except where the table says so.

`shape/` and `soft-light/` do not reproduce at their recorded settings: fitting
the model to them lands on cell 52.2 / contrast 43.5 rather than 50 / 50, and
their whole 100 px frame sits inside the edge artefact. They are kept as a
soft-light blend check, rendered with the fitted screen so the assertion is
about the blend. `shape-2/` and `contrast/` are the authoritative pair — fitting
cell size and contrast freely against `shape-2/` recovers exactly 33.6 and 75.

## Accuracy

Interior RMSE of the shipped renderer against the references, in 0-255 levels:

| Reference             | RMSE |
| --------------------- | ---- |
| contrast 0            | ~0   |
| contrast 25 / 50 / 75 | ~2.5 |
| shape-2 at 0°         | 1.6  |
| shape-2 at 45°        | 2.4  |
| shape-2 at 15°        | 5.0  |

Contrast 100 is compared loosely: a hard threshold disagrees by a full 255
wherever the crossing row is ambiguous, which one row per cell inevitably is.
15° is the worst angle because its bands cross pixel rows at the shallowest
slope, so a sub-pixel disagreement smears along the longest run.
