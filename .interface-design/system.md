# Oikos Design System

## Intent

**Who:** A parent or family member managing their household. They open this at the kitchen table, on the couch, on the phone while grocery shopping. They are juggling meals, tasks, calendars, budgets, and contacts - often simultaneously, often distracted.

**What they do:** Plan the week's meals. Check what to buy. See what's due today. Track the family budget. Coordinate schedules. Quick in, quick out.

**Feel:** Like a well-organized family kitchen - warm, practical, never sterile. Things have their place. Not a corporate dashboard, not a developer tool. Closer to a handwritten planner than a spreadsheet.

## Domain

Family household management. The physical references: a cork pinboard with notes, the family calendar on the fridge, a grocery list on paper, a budgeting notebook, ceramic tiles and warm wood, natural kitchen light.

## Signature

Each module owns a semantic accent color tied to its life domain - not arbitrary, but meaningful. Meals = warm orange (kitchen warmth). Tasks = green (checkmarks, completion). Calendar = violet (time, planning). Budget = teal (financial stability). Notes = gold (pinboard, paper). In standalone/PWA mode, the device status bar shifts color to match the active module.

## Palette

### Neutrals

Warm-tinted gray scale (not pure gray). Evokes linen, unbleached paper, natural materials. The warmth is subtle - you feel it more than see it.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--neutral-50` | `#FAFAF8` | `#1A1A18` | Lowest surface |
| `--neutral-100` | `#F5F4F1` | `#222220` | Canvas / background |
| `--neutral-150` | `#EFEEE9` | `#2A2A28` | Subtle border, surface-3 |
| `--neutral-200` | `#E8E7E2` | `#333331` | Default border |
| `--neutral-300` | `#D1D0CB` | `#48484A` | Disabled text |
| `--neutral-500` | `#8E8D89` | `#8E8D89` | Mid-tone (same both modes) |
| `--neutral-600` | `#6C6B67` | `#AEADB0` | Secondary text |
| `--neutral-900` | `#1C1C1A` | `#F5F4F1` | Primary text |

### Semantic Aliases

| Token | Value | Role |
|-------|-------|------|
| `--color-bg` | `neutral-100` | Page canvas |
| `--color-surface` | `#FFFFFF` / `#2A2A28` | Card, modal, dropdown |
| `--color-surface-2` | `neutral-50` | Inset, secondary surface |
| `--color-surface-3` | `neutral-150` | Tertiary surface |
| `--color-border` | `neutral-200` | Standard separation |
| `--color-border-subtle` | `neutral-150` | Softer separation |

### Module Accents

Each module has a dedicated color reflecting its life domain:

| Module | Light | Dark | Why |
|--------|-------|------|-----|
| Dashboard | `#2563EB` | `#60A5FA` | Blue - overview, neutral hub |
| Tasks | `#15803D` | `#4ADE80` | Green - completion, progress |
| Calendar | `#8250DF` | `#A78BFA` | Violet - time, planning |
| Meals | `#B45309` | `#F59E0B` | Orange - food, kitchen warmth |
| Shopping | `#D4511E` | `#FB923C` | Red-orange - action, movement |
| Notes | `#BF8700` | `#FCD34D` | Gold - pinboard, paper |
| Contacts | `#0969DA` | `#60A5FA` | Bold blue - people |
| Budget | `#1A7F5A` | `#34D399` | Teal - financial stability |
| Settings | `#6E7781` | `#94A3B8` | Gray - neutral configuration |

### Semantic Colors

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--color-success` | `#15803D` | `#4ADE80` | Positive states |
| `--color-warning` | `#B45309` | `#F59E0B` | Caution |
| `--color-danger` | `#DC2626` | `#FCA5A5` | Destructive, errors |
| `--color-info` | `#54AEFF` | - | Informational |

## Depth Strategy

**Subtle shadows** - three levels. No harsh borders for elevation. Borders define edges quietly; shadows provide lift.

| Level | Token | Use |
|-------|-------|-----|
| Resting | `--shadow-sm` | Cards, default surfaces |
| Raised | `--shadow-md` | Dropdowns, hover states |
| Floating | `--shadow-lg` | Modals, FAB, toasts |

Dark mode: stronger shadow opacity to compensate for reduced contrast against dark backgrounds. Borders become more important for definition.

## Typography

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto...`). Familiar to each platform, zero load time, never feels foreign. A family planner should feel native to the device - not branded.

| Level | Size | Weight | Use |
|-------|------|--------|-----|
| Caption | `--text-xs` (12px) | Regular | Badges, nav labels, metadata |
| Small | `--text-sm` (13px) | Regular/Medium | Secondary text |
| Body | `--text-base` (14px) | Regular | Default content (desktop) |
| Body mobile | `--text-md` (16px) | Regular | Default content (mobile), inputs |
| Section title | `--text-lg` (18px) | Semibold | Card/section headers |
| Subtitle | `--text-xl` (20px) | Semibold | Page subtitles |
| Page title | `--text-2xl` (24px) | Bold | Page headers |
| Hero | `--text-4xl` (36px) | Bold | Dashboard greeting |

## Spacing

4px base grid. Consistent across all components.

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | 4px | Icon gaps, micro spacing |
| `--space-2` | 8px | Tight component padding |
| `--space-3` | 12px | Standard component padding |
| `--space-4` | 16px | Card padding, section gaps |
| `--space-6` | 24px | Section spacing |
| `--space-8` | 32px | Major separation |

## Border Radius

Friendly but not bubbly. Cards are rounded enough to feel approachable, inputs slightly less.

| Token | Value | Use |
|-------|-------|-----|
| `--radius-xs` | 4px | Small badges, pills |
| `--radius-sm` | 8px | Inputs, buttons |
| `--radius-md` | 12px | Cards, dropdowns |
| `--radius-lg` | 16px | Modals, large cards |
| `--radius-xl` | 24px | Feature panels |
| `--radius-full` | 9999px | Avatars, toggles |

## Layout

### Mobile (< 1024px)
- Bottom navigation bar with swipeable two-page layout (5 modules per page)
- Dot indicator for current nav page
- Content area scrolls above fixed bottom nav

### Desktop (1024-1279px)
- Collapsed sidebar (56px) with icon-only navigation
- Content fills remaining width

### Wide Desktop (1280px+)
- Expanded sidebar (220px) with icons and labels
- Content max-width: 1280px

### Navigation
- Sidebar and canvas share the same background color (separated by border, not color)
- Active module indicated via `aria-current="page"` and accent color

## Transitions

| Speed | Duration | Use |
|-------|----------|-----|
| Fast | 150ms | Micro-interactions, hover |
| Base | 250ms | Standard transitions |
| Slow | 400ms | Page transitions, modals |

Easing: `cubic-bezier(0.16, 1, 0.3, 1)` for out-expo (page slides), `cubic-bezier(0.4, 0, 0.2, 1)` for standard ease-in-out.

## Dark Mode

Inverted warm neutrals (not cold). Surfaces get slightly lighter at higher elevation. Semantic colors shift to lighter/less saturated variants for readability on dark backgrounds. Shadows increase in opacity. Module accents shift to lighter variants.

Two triggers: `prefers-color-scheme: dark` (system) or `data-theme="dark"` (manual override). `data-theme="light"` forces light mode.

## Patterns to Preserve

- **Skeleton loading:** Cards show pulsing skeleton placeholders while data loads, then swap to real content
- **Module-specific CSS:** Each page has its own stylesheet loaded dynamically - keeps initial bundle minimal
- **Page transitions:** Directional slide animations based on navigation order (left/right)
- **Glass overlays:** `rgba(255, 255, 255, 0.18)` surfaces for elements on colored backgrounds (e.g., action buttons on module headers)
- **Priority system:** Four levels (urgent/high/medium/low) with dedicated color + translucent background tokens
- **Swipe gestures:** Touch-friendly item interactions (swipe to delete/complete) on mobile
