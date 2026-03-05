# Visual Guidelines (Ableton-Inspired)

## Design Intent
This UI follows an Ableton Live 12-inspired desktop tool style:
- Dark-first, neutral-heavy surfaces.
- Compact, information-dense controls.
- Single restrained orange accent for focus and active state.
- Flat panel chrome with subtle tiered contrast.
- No gradients for primary surfaces or controls.
- Thicker borders with tighter corner radii.

This is inspiration and not a proprietary visual clone.

## Core Tokens
- Surface tiers:
  - Canvas: `#1A1A1A`
  - Frame: `#202020`
  - Strip: `#2A2A2A`
  - Panel: `#252525`
  - Panel header: `#2F2F2F`
- Text tiers:
  - Primary: `#DDDDDD`
  - Secondary: `#B9B9B9`
  - Muted: `#8F8F8F`
- Lines:
  - Strong: `#4C4C4C`
  - Soft: `#3A3A3A`
  - Strong border width: `2px`
  - Soft border width: `2px`
- Accent:
  - Orange: `#FF8A2A`
  - Accent text: `#FFD9B0`
  - Accent soft bg: `#3F3021`

## Typography
- UI font stack: `"Barlow", "IBM Plex Sans", "Segoe UI", sans-serif`
- Code/address font stack: `"JetBrains Mono", "Cascadia Mono", Consolas, monospace`
- Compact desktop scale:
  - Base UI size: 13px
  - Header/meta labels: 11-12px
  - Table rows: 24px height
- Radius scale:
  - Small: 1px
  - Medium: 2px

## Layout and Component Rules
- Use a transport-style top strip for global actions and status.
- Keep panels as a 3-column workbench on desktop:
  - Browser
  - Disassembly
  - Inspector
- Panels are individually scrollable in their content regions.
- Panel widths are user-resizable via vertical splitters (desktop view).
- Panel headers should be narrow, uppercase, and metadata-aware.
- Tables stay dense with sticky headers and mono alignment for addresses/bytes.
- Active selection and actionable jump chips use orange-accent treatment.

## Motion and Interaction
- Use minimal purposeful motion:
  - Short boot-in transition for strip and panels.
- Keep hover/active feedback subtle and fast (100-150ms).
- Focus rings should use accent orange and be clearly visible.

## Responsiveness
- Desktop density is primary.
- At narrower widths:
  - Collapse the top strip into stacked rows.
  - Move from 3 columns to 2, then 1 column.
- Do not switch to touch-style large controls.
