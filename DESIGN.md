---
name: Hivemind
description: Dark command-deck for a multi-agent build swarm.
colors:
  honey: "#f2b24a"
  honey-bright: "#ffcd80"
  on-honey: "#221602"
  ok: "#41d386"
  err: "#f2685c"
  bg0: "#0b0e12"
  bg1: "#10151b"
  bg2: "#151c24"
  bg3: "#1c2530"
  line: "#222d3a"
  line2: "#2f3d4e"
  ink: "#e9eef4"
  mut: "#94a3b3"
  dim: "#7a8b9c"
  term: "#090c10"
  code: "#c9d6e2"
typography:
  display:
    fontFamily: "Space Grotesk, ui-sans-serif, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
  title:
    fontFamily: "Space Grotesk, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Manrope, ui-sans-serif, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Manrope, ui-sans-serif, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.on-honey}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.honey-bright}"
    textColor: "{colors.on-honey}"
  button-secondary:
    backgroundColor: "{colors.bg2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.mut}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  input:
    backgroundColor: "{colors.bg1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.bg1}"
    rounded: "{rounded.lg}"
  chip:
    backgroundColor: "{colors.bg2}"
    textColor: "{colors.mut}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: Hivemind

## Overview

**Creative North Star: "The Command Deck"**

Hivemind is a dark operations console, not a marketing site and not a pastel SaaS dashboard. One honey accent is the only raised voice. Everything else is graphite: stacked surfaces (`bg0`–`bg3`), hairline borders, and monospace for data. The product is a live swarm room — roster, stage track, group chat, workbench, CLI — so density and scanability beat decoration.

Motion is functional (speaking pulse, typing dots, stage current). It yields entirely under `prefers-reduced-motion`. Phone chrome collapses to one primary action and a Files sheet; desktop keeps the side workbench.

**Key Characteristics:**
- Dark-only; no light theme.
- Honey used for primary action, current stage, and brand mark — not large fills.
- Tonal depth (surface steps + 1px `line`) instead of drop shadows.
- Three faces: Space Grotesk (display), Manrope (UI), JetBrains Mono (data/CLI).
- 44px minimum hit targets below the `lg` breakpoint.

## Colors

A warm amber signal on a cool graphite stack. Status greens and reds are reserved for live/ok and error; they never compete with honey for “what to do next.”

### Primary
- **Honey** (`#f2b24a`): Primary buttons, current stage, brand glyph, links. Keep it scarce.
- **Honey bright** (`#ffcd80`): Hover on primary; emphasis text (`honey2`).
- **On honey** (`#221602`): Text and icons sitting on honey fills.

### Secondary
- **Ok** (`#41d386`): Success, live, on-PATH, completed stages.
- **Err** (`#f2685c`): Destructive hover, failed tests, alerts.

### Neutral
- **Void** (`#0b0e12` / `bg0`): Page field.
- **Deck** (`#10151b` / `bg1`): Header, cards, inputs.
- **Panel** (`#151c24` / `bg2`): Nested wells, chips, secondary buttons.
- **Raised** (`#1c2530` / `bg3`): Active nav, selected rows.
- **Line** (`#222d3a`) / **Line 2** (`#2f3d4e`): Default and hover borders.
- **Ink** (`#e9eef4`): Body and titles.
- **Mut** (`#94a3b3`): Secondary copy (AA).
- **Dim** (`#7a8b9c`): Meta, timestamps (AA on `bg1`).
- **Term** (`#090c10`) / **Code** (`#c9d6e2`): CLI and fenced blocks.

**The One Voice Rule.** Honey is the only chromatic call-to-action. If a control is not the next command, it is graphite.

## Typography

**Display Font:** Space Grotesk (sans fallback)
**Body Font:** Manrope (sans fallback)
**Label/Mono Font:** JetBrains Mono

**Character:** Display is tight and military-short. Body is the working sans. Mono is reserved for models, keys, CLI, and file paths — never as a costume for “technical.”

### Hierarchy
- **Display** (700, 26px page titles / 42px sign-in manifesto, ~1.06–1.1): Mission Studio, Settings, manifesto headline.
- **Title** (700, 14–16px): Card names, section `h2`, agent names.
- **Body** (500–600, 13px desktop / 16px inputs on phone): Chat, helper copy.
- **Label** (700, 10–11px, wide tracking, often uppercase): Field captions, roster kicker.
- **Mono** (400, 10.5–12px): Model ids, secrets, terminal.

**The Data Face Rule.** If a string is an identifier (model, key, path, command), it is mono. If it is a sentence, it is Manrope.

## Layout

Phone (`<1024px`): single column. Workspace header is mark + truncated title + one primary action + **Files**. Workbench is a full-screen sheet. Terminal is a 44px bar, 32vh when open. Safe-area insets on header and bottom chrome.

Desktop (`≥1024px`): chat + 440–500px workbench. Stage track appears at `xl`. Studio cards 1 / 2 / 3 columns at `md` / `xl`.

Spacing rhythm is 8 / 12 / 16 / 32. Cards pad 16–20px. Do not introduce a fluid type scale; product UI stays fixed rem/px.

## Elevation & Depth

Flat-by-default. Depth is the `bg0→bg3` stack plus 1px `line`. The only lifted surfaces are toasts and open combobox lists (`shadow-xl`). No ambient page shadows.

**The Hairline Rule.** A 1px `line` border is the default enclosure. Do not thicken it into a colored rail.

## Shapes

- Controls: 6px (`rounded-md`).
- Cards and dialogs: 8px (`rounded-lg`).
- Status and filters: pill (`rounded-full`).
- Avatars: 9px squircle, hue-tinted fill per agent.

No heavy radii, no squircles on buttons.

## Components

### Buttons
- **Shape:** 6px, 44px min-height below `lg`.
- **Primary:** Honey fill, on-honey text, bold 13px.
- **Secondary:** `bg2` fill, `line2` border, ink text; honey border on hover.
- **Ghost:** No fill; mut text → ink on hover.
- **Focus:** 2px honey ring, 2px `bg1` offset.
- **Disabled:** 40% opacity, no pointer.

### Chips
- Pill, `bg2`, `line2`, 11px mut. Selected: honey border + honey/10 fill.

### Cards / Containers
- 8px, `bg1`, 1px `line`. Nested wells use `bg2`. Approval callout: honey/40 border, honey/6 fill.

### Inputs / Fields
- `bg1`, `line2`, 6px. Focus: honey/60 border + honey ring. Phone inputs are 16px to avoid iOS zoom. Labels sit above the field and bind with `htmlFor`.

### Navigation
- Sticky 54px header, `bg1/90`. Active item: `bg3` + honey text. Phone hides the wordmark; the honey glyph remains the back/home control.

### Swarm roster (signature)
- Horizontal strip of hue-tinted glyphs + names. Desktop may show `provider · model`. Speaking state: honey/ok pulse on the glyph (disabled under reduced motion).

## Do's and Don'ts

### Do:
- **Do** keep honey scarce — one primary action per chrome cluster.
- **Do** use `dim` (`#7a8b9c`) or `mut` for secondary text so contrast stays ≥4.5:1.
- **Do** collapse workbench and CLI on small screens; never scale the desktop triad down.
- **Do** name icon-only or dual-mode controls with the visible word (`Files` / `Close` / `Hide files`).

### Don't:
- **Don't** introduce a light theme or a second accent hue.
- **Don't** dump native `<select>` catalogs; filter in a combobox and cap visible rows.
- **Don't** show model `<think>` scratchpads in the group chat.
- **Don't** rely on hover to reveal destructive actions.
