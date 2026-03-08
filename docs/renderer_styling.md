# Renderer Styling Guide

## Default Rule

Use shadcn/ui primitives plus Tailwind utility classes in the component that owns the markup.

## Keep CSS For

- Theme tokens and shared CSS variables in `app/src/renderer/styles/theme.css`
- Global element defaults and animations in `app/src/renderer/styles/base.css`
- Small cross-app utilities in `app/src/renderer/styles/utilities.css`
- True custom renderer output that is not practical to style inline, such as string-generated graph node HTML in `app/src/renderer/styles/custom-renderers.css`

## Prefer Component-Level Styling For

- Layout, spacing, borders, typography, and state styles
- shadcn/ui wrappers and app-specific composite components
- Panel shells, dialogs, status bars, list items, and other normal React markup

## Testing Rule

Do not couple tests to visual class names.

Prefer, in order:
- accessible roles and labels
- visible text
- `data-testid` for virtualization canvases, SVG slices, or other markup that has no better accessible handle

## Suggested Structure

- `components/ui/*` - shadcn/ui primitives
- `components/app/*` - app-specific wrappers built on those primitives
- `features/**` - feature-owned markup and Tailwind classes
- `styles/*.css` - tokens, base rules, tiny utilities, and unavoidable custom-renderer CSS only

## Review Checklist

Before adding new global CSS, ask:

1. Can this live directly in the component with Tailwind classes?
2. Can this be expressed as a reusable app wrapper instead of a global selector?
3. Is this styling a true custom renderer or SVG/HTML string that cannot reasonably use component classes?

If the answer to all three is no, keep it out of global CSS.
