# YM Global — design system

Midnight finance instrument: near-black blue canvas, frosted-glass panels lit by hairline edges, one violet accent, numbers set in tabular figures. Modelled on the Linear / Mercury / Authkit systems (styles.refero.design), adapted to YM's existing purple brand. Everything below is wired centrally — `tailwind.config.ts` (the `slate` scale IS the surface scale), `src/app/globals.css`, the root layout and the sidebar — so pages inherit it without per-page colours. **Never put literal hex colours in a page.**

## Colour

| Token (Tailwind) | Hex | Use |
|---|---|---|
| `slate-950` canvas | `#0b0c14` | page background; carries the ambient glow + blueprint grid |
| `slate-900` panel | `#12131d` | sidebar, top bar, cards (`bg-slate-900/60` = frosted card) |
| `slate-800` elevated | `#1a1b28` | hover rows, inner panels, table headers |
| `slate-700` control | `#242637` | inputs, secondary buttons, dividers on panels |
| `slate-600` edge-strong | `#343750` | section separators |
| `slate-500` muted | `#6e7390` | tertiary text, placeholders, icons at rest |
| `slate-400` ash | `#9aa0ba` | secondary text, labels |
| `slate-300` mist | `#c3c8dc` | secondary headings, table body text |
| `slate-200/100` ivory | `#dfe3f0` / `#ececf4` | primary text (never pure white for body) |
| `--edge` | `rgba(186,215,247,.12)` | hairline glass border on every panel and card |
| accent `purple-500` | `#8b5cf6` | THE one chromatic action: primary button, active nav, focus ring |
| `blue-500` | `#4da3ff` | informational only (links, pinned state) |
| `emerald-500` / `amber-500` / `red-500` | `#35d0a3` / `#f5b74a` / `#f0647c` | semantic status — good / attention / critical. Status ≠ accent. |

Rules: separation comes from the one-step value lift plus a hairline `--edge`, never drop shadows. No gradients on buttons or cards (the brand gradient survives only as the logo dot). No pure white body text.

## Type

Inter (variable) everywhere, loaded via `next/font`, with `font-feature-settings: 'cv01','ss03','zero'` and `tabular-nums` on anything numeric. Weights 400 / 500 / 600 — nothing heavier. Headings track tight (`-0.02em` ≥ 28px, `-0.01em` otherwise). Uppercase labels: 10–11px, `tracking-wider`, `slate-500`. Money: `tabular-nums`, right-aligned, same size as the row it lives in.

## Shape & space

Cards 12px (`rounded-xl`), controls 6–8px (`rounded-lg`), chips pill. Base unit 4px; card padding 20px; element gap 8px; section gap 24px inside the app frame. Max content width 80rem.

## Motion

One entrance: main content rises 6px and fades in over 240ms `cubic-bezier(.2,.8,.2,1)`. Rows and tiles lift on hover by background only (no transform, no shadow). Everything respects `prefers-reduced-motion`.

## Glass

Panels that float over the canvas (sidebar, top bar, drawers) use `backdrop-filter: blur(18px) saturate(140%)`, a 72% panel fill, the `--edge` hairline and an inset top highlight of 3% white. Cards do not blur (performance) — they get the same edge and inset highlight.
