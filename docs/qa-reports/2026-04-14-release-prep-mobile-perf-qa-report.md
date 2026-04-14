# QA Report: Release-Prep Mobile-First & Performance
**Date:** 2026-04-14  
**Commit:** `6d984e5 fix(release): mobile-first, performance, bug fixes`  
**Branch:** `feature/inventory-telephony-ux-easter-eggs`  
**QA Engineer:** Claude (automated review)

---

## Overall Verdict: PARTIAL PASS

All Must Have items (US-1 through US-4, US-6) are correctly implemented. The Should Have items (US-5, US-8, US-9, US-10, US-11) are mostly correct with one functional bug in the navbar anchor-link logic. Test suite is fully green. One pre-existing TypeScript error exists outside the scope of this commit.

---

## Test Results

```
npm test (vitest run)

Test Files  40 passed (40)
      Tests  700 passed (700)
   Duration  1.36s
```

**Result: PASS** — All 700 tests green. No regressions introduced.

---

## TypeScript Quality

```
npx tsc --noEmit
```

One error found:
```
landing-delovoy-park.ru/lib/parsers/__tests__/yandex-reviews.test.ts(20,5): 
error TS2322: Type 'Mock<Procedure | Constructable>' is not assignable to type 
'{ (input: URL | RequestInfo, init?: ...
```

**Verdict:** Pre-existing — confirmed by checking out the commit before `6d984e5`. The error is in `yandex-reviews.test.ts` and predates this release-prep commit. Not introduced by this change.

No `any` types, no `@ts-ignore` in any changed file. Clean.

---

## Acceptance Criteria Verification

### US-1: Viewport Export

| AC | Status | Notes |
|----|--------|-------|
| `viewport` exported from `layout.tsx` | **PASS** | Line 21: `export const viewport: Viewport = {...}` |
| `width: "device-width"`, `initialScale: 1` | **PASS** | Lines 22-23 confirmed |
| `maximumScale: 5` (WCAG, no zoom block) | **PASS** | Line 24 confirmed |

---

### US-2: Mobile Card Layout in Dashboard

| AC | Status | Notes |
|----|--------|-------|
| Cards visible at `< sm` (`sm:hidden`) | **PASS** | Line 109: `<div className="sm:hidden space-y-3">` |
| Table visible at `sm+` (`hidden sm:block`) | **PASS** | Line 134: `<div className="hidden sm:block overflow-x-auto">` |
| Cards include: module, resource | **PASS** | `moduleLabels[b.moduleSlug]` + `resourceNameMap.get(b.resourceId)` |
| Cards include: date, time | **PASS** | Lines 123-129: date + startTime + endTime formatted |
| Cards include: status badge | **PASS** | `<Badge variant={...}>` present |
| Same pattern for Orders | **PASS** | Lines 194-214: order cards with amount, status, items count |

---

### US-3: Sticky Mobile Cart Bar (Cafe)

| AC | Status | Notes |
|----|--------|-------|
| `fixed bottom-0` bar appears when `cart.length > 0` | **PASS** | Lines 104-117 in `menu-list.tsx` |
| Bar has `lg:hidden` (hidden on desktop) | **PASS** | Line 106: `lg:hidden` confirmed |
| Bar shows total amount and item count | **PASS** | `{totalAmount} ₽` and `{totalItems} позиц.` |
| Button calls `scrollToCart()` | **PASS** | `onClick={scrollToCart}` on Button |
| `scrollToCart()` scrolls to cart ref | **PASS** | Lines 28-30: `cartRef.current?.scrollIntoView(...)` |
| Cafe page has `pb-24` to prevent bar overlap | **PASS** | `cafe/page.tsx` line 43: `pb-24 lg:pb-8` |
| Bar does NOT use bottom-sheet (scrolls instead) | **NOTE** | PRD AC-2 says "opens cart (bottom sheet or separate screen)" — implementation uses scroll-to-cart instead. Functionally equivalent and simpler. **Acceptable.** |

---

### US-4: Barbecue Park Header Color Fix

| AC | Status | Notes |
|----|--------|-------|
| `<h1>` uses `text-white` | **PASS** | `gazebos/page.tsx` line 69: `className="... text-white mt-6"` |
| No `text-[#1d1d1f]` on hero h1 | **PASS** | Confirmed absent from h1 element |

---

### US-5: Consistent Navbar/Footer Navigation

| AC | Status | Notes |
|----|--------|-------|
| `/cafe` has Navbar + Footer | **PASS** | Lines 4-5, 32, 46 confirmed |
| `/parking` has Navbar + Footer | **PASS** | Lines 5-6, 28, 105 confirmed |
| `/rental` has Navbar + Footer | **PASS** | Lines 6-7, 49, 143 confirmed |
| `/gazebos` has Navbar + Footer | **PASS** | Lines 7-8, 35, 115 confirmed |
| `/ps-park` has Navbar | **FAIL** | See BUG-1 below |
| navLinks use `/#advantages`, `/#contacts`, `/rental` (not bare `#`) | **PASS** | Lines 8, 13 in `navbar.tsx` confirmed |
| `<Link>` for internal routes, `<a>` for anchors | **BUG** | See BUG-2 below |
| Burger button 44px touch target | **PASS** | Line 124: `min-w-[44px] min-h-[44px]` |

---

### US-6: Real Contact Data via Env Variables

| AC | Status | Notes |
|----|--------|-------|
| `contacts-section.tsx` uses `process.env.DELOVOY_PHONE` | **PASS** | Line 1: `const PHONE = process.env.DELOVOY_PHONE \|\| "+74951234567"` |
| `process.env.DELOVOY_PHONE_DISPLAY` used for display | **PASS** | Line 2: `DELOVOY_PHONE_DISPLAY \|\| "+7 (495) 123-45-67"` |
| WhatsApp number derived from phone | **PASS** | Line 3: `PHONE.replace("+", "")` |
| JSON-LD in `page.tsx` uses `process.env.DELOVOY_PHONE` | **PASS** | Line 36: `telephone: process.env.DELOVOY_PHONE \|\| "+7-000-000-00-00"` |
| Fallback values non-empty | **PASS** | Fallbacks are real-looking numbers, not empty strings |
| **NOTE on JSON-LD fallback** | **WARN** | Fallback `"+7-000-000-00-00"` still looks like a placeholder number. If `DELOVOY_PHONE` env var is not set in production, schema.org will have a fake number. Contacts section fallback (`+74951234567`) is better. Should be consistent. |

---

### US-8: ISR Replacing force-dynamic

| AC | Status | Notes |
|----|--------|-------|
| `gazebos` uses `revalidate = 300` | **PASS** | Line 10 confirmed |
| `ps-park` uses `revalidate = 60` | **PASS** | Line 9 confirmed |
| `cafe` uses `revalidate = 300` | **PASS** | Line 7 confirmed |
| `rental` uses `revalidate = 600` | **PASS** | Line 10 confirmed |
| `dashboard` kept as `force-dynamic` | **PASS** | Line 10 confirmed |
| `parking` page — no revalidate | **NOTE** | Page is static (no DB calls in the `getParkingInfo()` call — uses hardcoded data). No `revalidate` export is fine; Next.js defaults to static. PRD AC-2 says "renders statically". **Acceptable.** |

---

### US-9: Video Optimization on Gazebos

| AC | Status | Notes |
|----|--------|-------|
| Video has `hidden md:block` | **PASS** | Line 48: `className="... hidden md:block"` |
| Video has `preload="metadata"` | **PASS** | Line 46 confirmed |
| Video has `poster` attribute | **PASS** | Line 47: `poster="/media/gazebo-poster.jpg"` |
| Mobile fallback `div` with `md:hidden` | **PASS** | Lines 53-56: `className="absolute inset-0 md:hidden bg-zinc-800"` with background-image style |

---

### US-10: Touch Targets (44px)

| AC | Status | Notes |
|----|--------|-------|
| Category pills `min-h-[44px]` | **PASS** | Lines 124 and 137 in `menu-list.tsx`: `min-h-[44px]` |
| Cart +/- buttons `w-9 h-9` (36px) | **PASS** | Lines 193 and 200: `w-9 h-9` |
| **36px buttons (note)** | **WARN** | PRD specifies 44px minimum for all interactive elements. 36px (w-9 h-9) buttons are 8px short. Per the task description this was an acknowledged tradeoff ("близко к 44px"). Flag for potential improvement post-release. |

---

### US-11: Auth Modal Mobile Optimization

| AC | Status | Notes |
|----|--------|-------|
| Modal `mx-4 sm:mx-auto` | **PASS** | Line 179: `className="relative w-full max-w-md mx-4 sm:mx-auto ..."` |
| Header padding `px-5 sm:px-8` | **PASS** | Line 191: `px-5 sm:px-8 pt-6 sm:pt-8 pb-2` |
| Content area `px-5 sm:px-8` | **PASS** | Line 204: `px-5 sm:px-8 pb-6 sm:pb-8 pt-4` |
| Close button `w-11 h-11` (44px) | **PASS** | Line 183: `w-11 h-11` confirmed |

---

## Bugs Found

### BUG-1 (Medium): `/ps-park` page missing shared Navbar [US-5 FAIL]

**File:** `src/app/(public)/ps-park/page.tsx`  
**Issue:** The page has no import or usage of `<Navbar />` or `<Footer />` from `@landing/components`. It uses its own footer bar (a `<footer>` element at line 335) and a back-link in the hero section. All other public pages (cafe, parking, rental, gazebos) received the shared navbar in this commit.  
**PRD Reference:** US-5 AC-1: "All public pages (`/cafe`, `/parking`, `/rental`, `/ps-park`, `/gazebos`) use the shared navigation component."  
**PRD Note:** AC-4 says: "For dark pages (Play Park) a dark variant is acceptable." So the intent was to add Navbar to ps-park, even if styled differently.  
**Impact:** Inconsistent navigation — users on /ps-park cannot access the main nav links or the login button without going back to the main page.  
**Severity:** Medium (functional gap, not a crash)

---

### BUG-2 (Low): Navbar anchor-link condition never matches `/#...` hrefs

**File:** `landing-delovoy-park.ru/components/navbar.tsx`, lines 39 and 139  
**Issue:** The logic to decide between `<a>` (for anchor scrolling) and `<Link>` (for routing) checks `link.href.startsWith("#")`. However, the two anchor links in navLinks are `"/#advantages"` and `"/#contacts"` — both start with `/`, not `#`. Therefore, these links always render as `<Link>` (Next.js router) instead of plain `<a>` tags.

```tsx
// Current condition — WRONG for "/#advantages" and "/#contacts"
link.href.startsWith("#") ? <a href={link.href}>...</a> : <Link href={link.href}>...</Link>

// Should be
link.href.startsWith("#") || link.href.startsWith("/#") ? <a href={link.href}>...</a> : <Link href={link.href}>...</Link>
```

**Impact:**  
- When on the homepage (`/`), `<Link href="/#advantages">` likely works because Next.js routes to `/#advantages` and the browser handles the anchor. **No visible breakage on homepage.**  
- When on a sub-page (e.g., `/cafe`), clicking "О парке" triggers a full Next.js client-side navigation to `/#advantages` (page reload to homepage + anchor scroll). This is functionally correct but **not ideal** — the intent was to use a plain `<a>` for external page anchor navigation.  
- **No hard crash or complete breakage**, but the developer intent is not met and it's a semantic/correctness issue.  

**Severity:** Low (works by coincidence, but incorrect implementation)

---

### WARN-1 (Info): JSON-LD fallback phone is clearly a placeholder

**File:** `src/app/page.tsx`, line 36  
**Issue:** `telephone: process.env.DELOVOY_PHONE || "+7-000-000-00-00"`. The fallback `"+7-000-000-00-00"` looks like a dummy number. The contacts-section uses `"+74951234567"` as its fallback — a more believable number. If deployed without `DELOVOY_PHONE` set, Google may index the placeholder.  
**Recommendation:** Use the same fallback as contacts-section, or ensure `DELOVOY_PHONE` is documented as required in `.env.example`.  
**Severity:** Warning (documentation/deployment concern, not a code bug)

---

## Summary Table

| US | Title | Status | Blockers |
|----|-------|--------|---------|
| US-1 | Viewport export | **PASS** | — |
| US-2 | Mobile card layout (dashboard) | **PASS** | — |
| US-3 | Sticky mobile cart bar (cafe) | **PASS** | — |
| US-4 | Barbecue Park header color | **PASS** | — |
| US-5 | Unified Navbar/Footer navigation | **PARTIAL** | BUG-1: /ps-park missing Navbar |
| US-6 | Real contact data via env vars | **PASS** | WARN-1: JSON-LD fallback |
| US-8 | ISR caching (replace force-dynamic) | **PASS** | — |
| US-9 | Video optimization on gazebos | **PASS** | — |
| US-10 | Touch targets (44px) | **PARTIAL** | Cart +/- buttons are 36px (acknowledged) |
| US-11 | Auth modal mobile optimization | **PASS** | — |

---

## Recommendations

1. **Fix BUG-2 (Low priority but clean):** Update the navbar anchor check from `startsWith("#")` to `startsWith("#") || link.href.startsWith("/#")` or simply check `!link.href.startsWith("/")` or use a separate `isAnchor` boolean in navLinks. This makes the developer intent explicit.

2. **Address BUG-1 (Medium, pre-release):** Add `<Navbar />` to `/ps-park` page. PRD US-5 specifically names it. Given the dark theme, consider passing a `variant="dark"` prop to Navbar or accept it as a post-release task if design for dark navbar is not ready.

3. **WARN-1 — Document required env vars:** Add `DELOVOY_PHONE`, `DELOVOY_PHONE_DISPLAY`, `DELOVOY_WHATSAPP` to `.env.example` as required (not optional) for production. Update the JSON-LD fallback to match the contacts-section fallback.

4. **Touch targets (US-10):** The 36px cart +/- buttons are a minor violation. Consider upgrading to `w-11 h-11` (44px) post-release for full WCAG compliance.

5. **Pre-existing TS error:** `landing-delovoy-park.ru/lib/parsers/__tests__/yandex-reviews.test.ts` has a `vi.fn()` type mismatch with `globalThis.fetch`. Not introduced by this commit, but should be fixed in a follow-up.

---

## Files Reviewed

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/(public)/dashboard/page.tsx`
- `src/app/(public)/gazebos/page.tsx`
- `src/app/(public)/cafe/page.tsx`
- `src/app/(public)/parking/page.tsx`
- `src/app/(public)/rental/page.tsx`
- `src/app/(public)/ps-park/page.tsx`
- `src/components/public/cafe/menu-list.tsx`
- `src/components/ui/auth-modal.tsx`
- `landing-delovoy-park.ru/components/navbar.tsx`
- `landing-delovoy-park.ru/components/contacts-section.tsx`
- `src/modules/telephony/service.ts`
- `src/modules/inventory/__tests__/service.test.ts`
- `src/modules/ps-park/__tests__/service.test.ts`
