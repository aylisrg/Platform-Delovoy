# Design System: Apple Light

## 1. Visual Theme & Atmosphere

The platform adopts Apple's signature design language: a clean, bright, spacious canvas that radiates confidence through restraint. The entire experience is built on pure white and light gray surfaces, where typography and content take center stage. Every element feels grounded, precise, and intentionally placed — nothing competes for attention because the hierarchy does the work.

The typography is the quiet signature: Manrope for display headings with moderate negative letter-spacing creates headlines that feel confident and modern without being aggressive. The transition to Inter for body text ensures readability and a refined, systematic feel. Apple Blue (`#0071e3`) is deployed sparingly but decisively — as link color, button fills, and focus indicators — creating a calm, trustworthy throughline across the interface.

The overall effect is a premium product experience: bright, precise, welcoming, and unapologetically content-forward. Every section exists to communicate clearly, with the design itself serving as proof of craftsmanship.

**Key Characteristics:**
- Pure white (`#ffffff`) and light gray (`#f5f5f7`) alternating canvas — clean, bright, spacious
- Manrope display font with moderate negative letter-spacing (-1px to -2px)
- Apple Blue (`#0071e3`) as the primary accent color — calm, trustworthy, precise
- Pill-shaped buttons (`rounded-full`) — smooth, approachable interactive elements
- Content-first layout — typography and whitespace do the heavy lifting
- Subtle shadows and borders using `border-black/[0.04]` and `border-black/[0.08]`
- Inter for body text with clean, systematic readability

## 2. Color Palette & Roles

### Primary
- **Pure White** (`#ffffff`): Primary background, card surfaces, input backgrounds
- **Near Black** (`#1d1d1f`): Primary text color — headings, body text, high-emphasis content
- **Apple Blue** (`#0071e3`): Primary accent color — links, buttons, focus states, interactive highlights

### Secondary & Accent
- **Muted Gray** (`#86868b`): Secondary text, subdued labels, descriptions, captions
- **Light Gray** (`#f5f5f7`): Alternating section backgrounds, secondary surfaces, input backgrounds

### Surface & Background
- **White** (`#ffffff`): Page background, primary canvas, card surfaces
- **Light Gray** (`#f5f5f7`): Section backgrounds, hover states, secondary surfaces
- **Hover Gray** (`#ebebed`): Hover state for interactive elements on light gray

### Neutrals & Text
- **Near Black** (`#1d1d1f`): Heading text, high-emphasis body text
- **Muted Gray** (`#86868b`): Body text, descriptions, secondary information
- **Subtle Gray** (`#86868b` at 60% opacity): Tertiary text, helper text, placeholders

### Borders & Dividers
- **Light Border** (`border-black/[0.04]`): Section dividers, subtle separators
- **Medium Border** (`border-black/[0.08]`): Input borders, card outlines
- **Active Border** (`border-black/[0.12]`): Hover state borders

### Semantic & Accent
- **Apple Blue** (`#0071e3`): Links, primary buttons, focus rings
- **Blue Hover** (`#0077ED`): Hover state for blue buttons
- **Blue Focus Ring** (`#0071e3` at 20% opacity): Focus ring shadow for inputs
- **Module Green** (`#16A34A`): Gazebo-specific accent — selected states, success indicators

### Gradient System
- No prominent gradient usage — the system relies on flat surfaces with subtle shadows and borders for depth
- Occasional soft shadows for elevation rather than gradients

## 3. Typography Rules

### Font Family
- **Display**: `Manrope` via `font-[family-name:var(--font-manrope)]` — modern geometric sans-serif, weight 500-600
- **Body/UI**: `Inter` via `font-[family-name:var(--font-inter)]` — clean, systematic sans-serif for readability

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | Manrope | clamp(36px, 5vw, 56px) | 500 | 0.95 | -2px | Confident, not aggressive |
| Section Display | Manrope | 48px | 600 | 1.00 | -1.5px | Clean section headers |
| Section Heading | Manrope | 32px | 600 | 1.10 | -1px | Feature section headers |
| Feature Heading | Manrope | 24px | 600 | 1.15 | -0.5px | Card and subsection headers |
| Card Title | Manrope | 20px | 600 | 1.20 | -0.4px | Card headers, item titles |
| Body Large | Inter | 18px | 400 | 1.50 | normal | Intro paragraphs, descriptions |
| Body | Inter | 15px | 400 | 1.60 | normal | Standard body text |
| Body Small | Inter | 14px | 400 | 1.50 | normal | Secondary body text |
| Caption | Inter | 13px | 400 | 1.40 | normal | Labels, metadata |
| Small | Inter | 12px | 400 | 1.40 | normal | Helper text, fine print |
| Badge | Inter | 12px | 500 | 1.10 | normal | Tags, status indicators |

### Principles
- **Restraint as personality**: Manrope's moderate negative letter-spacing (-1px to -2px) creates confident headings without being aggressive
- **Readability first**: Inter body text at comfortable sizes (14-18px) with generous line-heights (1.5-1.6)
- **Weight clarity**: Manrope at 500-600 for headings, Inter at 400 for body — clear visual hierarchy without extremes
- **Generous line heights**: Body text at 1.5-1.6 line-height ensures comfortable reading on all screen sizes

## 4. Component Stylings

### Buttons
- **Primary Blue Pill**: `bg-[#0071e3] text-white hover:bg-[#0077ED] rounded-full` — the main CTA, confident and approachable
- **Secondary Light Pill**: `bg-[#1d1d1f]/[0.06] hover:bg-[#1d1d1f]/[0.1] text-[#1d1d1f] rounded-full` — secondary actions, subtle and clear
- **Ghost**: No visible background, blue text (`text-[#0071e3]`), hover reveals subtle background
- **Disabled**: `opacity-50 cursor-not-allowed` — clear but unobtrusive

### Cards & Containers
- **White Card**: `bg-white rounded-2xl shadow-sm` — clean, elevated on gray backgrounds
- **Gray Card**: `bg-[#f5f5f7] rounded-2xl` — subtle containment on white backgrounds, `hover:bg-[#ebebed]` for interactive
- **Bordered Card**: `bg-white rounded-2xl border border-black/[0.08]` — explicit containment when needed
- **Hover**: Subtle background shift or border darkening

### Inputs & Forms
- **Input Base**: `bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm`
- **Placeholder**: `placeholder-[#86868b]/50`
- **Focus State**: `focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20 focus:outline-none`
- **Label**: `text-[#86868b] text-xs` above input with `mb-1.5` spacing
- **Textarea**: Same as input with `resize-none`

### Navigation
- **Light floating nav bar**: White background, subtle bottom border, dark text links
- **Nav links**: Inter at 15px, weight 400, `text-[#1d1d1f]` with subtle hover opacity change
- **CTA button**: Pill-shaped, blue (`bg-[#0071e3]`), positioned at right end of nav
- **Mobile**: Collapses to hamburger menu, maintains light theme
- **Sticky behavior**: Nav remains fixed at top on scroll

### Image Treatment
- **Clean composition**: Images placed on white or light gray backgrounds with rounded corners (12px-16px)
- **Subtle shadows**: `shadow-sm` or `shadow-md` for depth separation
- **Rounded corners**: `rounded-2xl` for consistency with the card system
- **Aspect ratios**: Maintained responsively within containers

### Trust & Social Proof
- Customer logos and testimonials on clean white or light gray surfaces
- Minimal ornamentation — content and typography carry trust

## 5. Layout Principles

### Spacing System
- **Base unit**: 4px
- **Scale**: 1px, 2px, 4px, 6px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px
- **Section padding**: Large vertical spacing (80px-120px between sections)
- **Card padding**: 20px-32px internal padding
- **Component gaps**: 12px-24px between related elements

### Grid & Container
- **Max width**: 1200px container, centered
- **Column patterns**: Full-width hero, 2-3 column feature grids, single-column content
- **Symmetric layouts**: Clean, balanced compositions

### Whitespace Philosophy
- **Breathe through brightness**: Generous vertical spacing between sections — white backgrounds create natural rhythm through spacing alone
- **Spacious throughout**: Both individual components and their surroundings have breathing room
- **Content-first clarity**: Each section has a clear purpose with whitespace providing natural boundaries

### Border Radius Scale
- **4px**: Small UI elements, badges, tags
- **8px**: Standard components — inputs, small buttons
- **12px**: Cards, containers — `rounded-xl`
- **16px**: Large containers, feature cards — `rounded-2xl`
- **9999px / full**: Pill buttons, navigation CTAs — `rounded-full`

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Level 0 (Flat) | No shadow, white or `#f5f5f7` surface | Page background, section backgrounds |
| Level 1 (Subtle) | `shadow-sm` | Cards on gray backgrounds, light elevation |
| Level 2 (Medium) | `shadow-md` | Floating elements, dropdowns |
| Level 3 (Prominent) | `shadow-lg` | Modals, overlays, popovers |

### Shadow Philosophy
The Apple light elevation system uses subtle, diffused shadows that create gentle depth without drawing attention. Shadows are soft and spread wide, never creating harsh edges.

### Border-Based Depth
- **Light borders** (`border-black/[0.04]`): Section dividers, the lightest containment
- **Medium borders** (`border-black/[0.08]`): Input fields, card outlines
- **Active borders** (`border-black/[0.12]`): Hover states, emphasized containment

### Decorative Depth
- No glow effects or colored shadows
- Depth is communicated through background color changes (`#ffffff` → `#f5f5f7`) and subtle shadows
- Clean, physical-feeling elevation without digital artifacts

## 7. Do's and Don'ts

### Do
- Use white (`#ffffff`) and light gray (`#f5f5f7`) as primary backgrounds — alternating for section rhythm
- Apply moderate negative letter-spacing on Manrope display text (-1px to -2px)
- Keep all CTA buttons pill-shaped (`rounded-full`) — approachable and clear
- Use Apple Blue (`#0071e3`) exclusively for interactive accents — links, buttons, focus states
- Deploy `bg-[#f5f5f7]` for secondary surfaces and subtle containment
- Maintain Manrope at weight 500-600 for headings — confident but not aggressive
- Use Inter for all body text and UI elements at weight 400
- Let content and typography be the visual centerpiece
- Apply `border-black/[0.04]` or `border-black/[0.08]` for subtle containment

### Don't
- Use dark backgrounds (no `#000000`, `#1a1a1a`, or any dark surfaces for content areas)
- Apply bold (700+) weight to display headings — 500-600 only
- Introduce additional accent colors beyond Apple Blue (module-specific accents like green are acceptable)
- Use heavy drop shadows or colored shadow glows
- Add decorative borders or ornamental elements
- Use positive letter-spacing on headlines
- Create glass/frosted effects or translucent surfaces
- Place colored backgrounds behind content sections — white and `#f5f5f7` only
- Use serif fonts — the system is geometric sans-serif only

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <768px | Single column, stacked sections, reduced heading sizes, hamburger nav |
| Tablet | 768px-1199px | 2-column grids begin, nav partially visible |
| Desktop | >1199px | Full layout, expanded nav, 3-column grids, full heading sizes |

### Touch Targets
- Pill buttons: minimum 44px height — meets WCAG minimum
- Nav links: generous padding for touch accessibility
- Mobile CTA buttons: Full-width pills on mobile for easy thumb reach

### Collapsing Strategy
- **Navigation**: Full horizontal nav -> hamburger menu at mobile breakpoint
- **Hero text**: Scales via clamp() — responsive without breakpoint jumps
- **Feature sections**: Grid columns reduce: 3 -> 2 -> 1 across breakpoints
- **Section spacing**: Reduces proportionally — 120px desktop -> 60px mobile

### Image Behavior
- Images are responsive, scaling within their container boundaries
- Consistent rounded corners maintained across breakpoints
- Images lazy-load as user scrolls into view

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary Background: White (`#ffffff`)
- Secondary Background: Light Gray (`#f5f5f7`)
- Primary Text: Near Black (`#1d1d1f`)
- Secondary Text: Muted Gray (`#86868b`)
- Accent/CTA: Apple Blue (`#0071e3`)
- Accent Hover: Blue Hover (`#0077ED`)
- Light Border: `border-black/[0.04]`
- Medium Border: `border-black/[0.08]`
- Focus Ring: `focus:ring-[#0071e3]/20`

### Example Component Prompts
- "Create a hero section on white background with Manrope heading in `#1d1d1f`, letter-spacing -2px, line-height 0.95, and a pill-shaped blue CTA button (`bg-[#0071e3] text-white rounded-full`) with hover state `hover:bg-[#0077ED]`"
- "Design a feature card on `bg-[#f5f5f7]` with `rounded-2xl`, `text-[#1d1d1f]` Manrope heading at 20px weight 600, and `text-[#86868b]` Inter body text, with `hover:bg-[#ebebed]` transition"
- "Build a navigation bar with white background, `border-b border-black/[0.04]`, Inter text links in `#1d1d1f` at 15px, and a pill-shaped blue CTA button at the right"
- "Create an input field with `bg-white border border-black/[0.08] rounded-xl px-4 py-3`, `text-[#1d1d1f]`, `placeholder-[#86868b]/50`, and `focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20`"
- "Design a summary card with `bg-white rounded-2xl shadow-sm`, `text-[#86868b]` labels, `text-[#1d1d1f]` values, and `border-b border-black/[0.04]` dividers between rows"

### Iteration Guide
When refining existing screens generated with this design system:
1. Focus on ONE component at a time — the clean canvas makes every element visible
2. Always verify letter-spacing on Manrope headings — moderate negative tracking (-1px to -2px) is the signature
3. Check that Apple Blue appears ONLY on interactive elements — never as decorative background or non-link text
4. Ensure all CTA buttons are pill-shaped (`rounded-full`) — any squared corner breaks the aesthetic
5. Test light gray surfaces by checking they use exactly `#f5f5f7` — too dark looks heavy, too light disappears against white
