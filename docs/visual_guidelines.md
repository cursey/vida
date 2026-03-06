# Visual Guidelines (Shadcn Site Parity)

## Design Intent
The renderer should mirror the visual language of `ui.shadcn.com`:
- Shared semantic tokens for both light and dark themes.
- Geist Sans / Geist Mono typography baseline.
- Shared component primitives for all interactive controls.
- Clean, neutral styling with predictable states and spacing.

## Theme and Tokens
- Maintain both `:root` (light) and `.dark` token sets.
- Use semantic variables for app surfaces and controls:
  - `background`, `foreground`
  - `card`, `popover`
  - `primary`, `secondary`, `accent`, `muted`
  - `destructive`, `border`, `input`, `ring`
- Theme switching policy:
  - default: system
  - user override options: `light`, `dark`, `system`
  - persisted via `vite-ui-theme`

## Typography
- Base UI font: Geist Sans (`--font-sans`).
- Monospace/code font: Geist Mono (`--font-mono`).
- Avoid legacy uppercase-heavy and tight letter-spacing treatments for headers/meta text.
- Use shadcn-like text scale and weight defaults for panel chrome and controls.

## Component and Interaction Rules
- Use shared primitives (`Button`, `Input`, `Dialog`, `Badge`, `ScrollArea`, `Separator`, `DropdownMenu`) rather than raw controls in feature components.
- Keep focus rings and invalid states aligned with shadcn semantics.
- Keep destructive/warning/success states semantic, not hardcoded per component.

## Layout and RE-Specific Behavior
- Preserve 3-panel workbench behavior and panel resize interaction.
- Preserve virtualized disassembly rendering for performance.
- Mnemonic category colors are allowed but should remain subtle and consistent with the active theme.
