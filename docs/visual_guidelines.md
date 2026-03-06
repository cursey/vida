# Visual Guidelines (Shadcn Consistency Baseline)

## Design Intent
The renderer UI uses a `shadcn/ui` consistency model:
- Dark-first interface with stable semantic tokens.
- Shared primitives for all interactive controls.
- Dense desktop-oriented layout for reverse-engineering workflows.
- Predictable spacing, typography, and state styling across panels.

## Token Baseline
- Theme source: CSS variables aligned with shadcn default dark token structure.
- Primary semantic layers:
  - `background` for app canvas
  - `card` for panel bodies
  - `secondary` for panel headers/chrome
  - `border`/`input` for separators and control outlines
  - `primary` for selected/active emphasis
  - `destructive` for error surfaces
- Radius scale follows shadcn defaults (`lg`/`md`/`sm` based on `--radius`).

## Component Rules
- Use shared UI primitives for controls:
  - `Button`
  - `Input`
  - `Dialog`
  - `Badge`
  - `ScrollArea`
  - `Separator`
- Do not introduce raw `button`/`input` elements in renderer feature components.
- Feature surfaces should compose primitives rather than redefining ad hoc control styles.

## Layout and Density
- Preserve 3-panel workbench behavior:
  - Browser
  - Disassembly
  - Inspector
- Keep panel resize behavior and independent panel scrolling.
- Keep disassembly rendering dense and monospaced, with custom virtualization preserved for performance.

## Interaction and States
- Active panel and current-row states must be visually distinct and consistent with semantic tokens.
- Focus visibility must remain clear (`ring`-based, keyboard-friendly).
- Error and offline states must use destructive semantics rather than one-off colors.

## Motion
- Limit motion to short, purposeful transitions.
- Use subtle panel/dialog entrance animation only where it improves orientation.
