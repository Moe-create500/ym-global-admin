# YM Global — design system

Daylight ledger: a cool off-white canvas, white cards separated by hairline edges and a soft lift, near-black ink for text, one violet accent, numbers set in tabular figures. Built for reading, not for glow. Modelled on the Linear / Mercury / Authkit systems (styles.refero.design), adapted to YM's existing purple brand. Everything below is wired centrally — `tailwind.config.ts` (the `slate` scale IS the surface scale), `src/app/globals.css`, the root layout and the sidebar — so pages inherit it without per-page colours. **Never put literal hex colours in a page.**

## Colour

| Token (Tailwind) | Hex | Use |
|---|---|---|
| `slate-950` canvas | `#f4f5fa` | page background; faint violet/blue glow top corners |
| `slate-900` panel | `#ffffff` | sidebar, cards (`bg-slate-900/60` = white card with edge + lift) |
| `slate-800` elevated | `#eef0f6` | hover rows, inner panels, table headers |
| `slate-700` control | `#e3e6ef` | inputs, secondary buttons, dividers |
| `slate-600` edge-strong | `#cfd4e2` | section separators |
| `slate-500` muted | `#7a819b` | tertiary text, placeholders |
| `slate-400` secondary | `#5d6480` | secondary text, labels |
| `slate-300` | `#3f4560` | table body text |
| `slate-200 / 100 / 50` ink | `#2a3047` / `#1b2036` / `#141626` | primary text (`text-white` is remapped to ink) |
| `--edge` | `#e3e6ef` | hairline border on every card and panel |
| accent `purple-500` | `#6d4aff` | THE one chromatic action: primary button, active nav, focus ring |
| `blue-500` | `#2f6fe0` | informational only (links, pinned state) |
| `emerald-500` / `amber-500` / `red-500` | `#1f9d6e` / `#b7791f` / `#d2445a` | semantic status — good / attention / critical. Their 300/400 steps are readable dark inks; 800–950 are light washes. |

Rules: separation comes from a hairline `--edge` plus one soft lift shadow (`--shadow`), never heavy drop shadows. No gradients on buttons or cards (the brand gradient survives only as the logo dot). No pure white body text.

## Type

Inter (variable) everywhere, loaded via `next/font`, with `font-feature-settings: 'cv01','ss03','zero'` and `tabular-nums` on anything numeric. Weights 400 / 500 / 600 — nothing heavier. Headings track tight (`-0.02em` ≥ 28px, `-0.01em` otherwise). Uppercase labels: 10–11px, `tracking-wider`, `slate-500`. Money: `tabular-nums`, right-aligned, same size as the row it lives in.

## Shape & space

Cards 12px (`rounded-xl`), controls 6–8px (`rounded-lg`), chips pill. Base unit 4px; card padding 20px; element gap 8px; section gap 24px inside the app frame. Max content width 80rem.

## Motion

One entrance: main content rises 6px and fades in over 240ms `cubic-bezier(.2,.8,.2,1)`. Rows and tiles lift on hover by background only (no transform, no shadow). Everything respects `prefers-reduced-motion`.

## Glass

Panels that float over the canvas (sidebar, drawers) use `backdrop-filter: blur(18px) saturate(140%)` over a 78–96% white fill with the `--edge` hairline. Cards do not blur (performance) — they get the edge and the soft lift.
