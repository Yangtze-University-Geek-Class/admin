# Page Design Spec

> Visual and interaction baseline for the three sites (portal / forum / admin) after the refactor. Every value and clause comes from authoritative standards and first-party vendor documentation (verified 2026-09-12); sources are listed per section.
> Technical version baseline: [STACK.md](./STACK.md). 中文：[DESIGN.md](./DESIGN.md)

---

## 0. Basis and Scope

| Layer | Basis | Status |
|---|---|---|
| Accessibility | **WCAG 2.2 Level AA** (W3C Recommendation) | Mandatory |
| Component interaction | **WAI-ARIA Authoring Practices (APG)** | Mandatory (component implementation) |
| Chinese typography | **W3C clreq** + GB/T 15834—2011 | Mandatory (Chinese UI) |
| Visual metrics | **Ant Design** (Chinese baseline) + Material Design 3 + Apple HIG | Reference; conflicts resolved per §5.6 |
| States and patterns | Ant Design + IBM Carbon | Reference |

**Acceptance baseline**: the **full WCAG 2.2 AA**; focus styling designed to `2.4.13 Focus Appearance` (AAA).

> Note: `2.4.11` is AA and `2.4.13` is AAA; `3.2.6` and `3.3.7` are **Level A** (more fundamental than AA, and not optional).

---

## 1. Accessibility Baseline

### 1.1 Criteria That Must Be Met

| SC | Level | Hard requirement | Where this project lands |
|---|---|---|---|
| 1.4.3 Contrast (Minimum) | AA | Body text **≥4.5:1**; large text **≥3:1**. Large text = ≥18pt or ≥14pt bold (CJK equivalent 1.5em) | Seal blue (校徽蓝) as body color, secondary gray text, and placeholders all measured; disabled states may be exempt |
| 1.4.10 Reflow | AA | No horizontal scrolling at 320 CSS px wide | Mandatory on mobile and narrow viewports, including dialogs and tables |
| 1.4.11 Non-text Contrast | AA | UI components and graphics **≥3:1** | Icon buttons, input borders, selected states |
| 1.4.12 Text Spacing | AA | Content **must not be lost** when the user overrides line height 1.5× / paragraph spacing 2× / letter spacing 0.12× / word spacing 0.16× | **Every card uses `min-height`, never a fixed `height`**; `overflow: hidden` truncation is banned |
| 2.4.7 Focus Visible | AA | The keyboard focus indicator is visible | Globally ban `outline: none` with no replacement (failure F78) |
| 2.4.11 Focus Not Obscured | AA | A focused element must not be **entirely** obscured | Sticky headers and the floating `FeedbackFab` layer are the risk points; add `scroll-padding` to scroll containers |
| 2.4.13 Focus Appearance | AAA | Focus indicator ≥ 2px thick perimeter, **≥3:1** against adjacent colors | One focus ring at 2px + 3:1, as the design target |
| 2.5.7 Dragging Movements | AA | Any drag operation must be completable with a single pointer and no dragging | Sorting, sliders, drag-and-drop upload (if any) |
| 2.5.8 Target Size (Minimum) | AA | Targets **≥24×24 CSS px**; where smaller, 24px-diameter circles must not intersect | Icon buttons, table action columns, dense button rows; **inline links inside a sentence are exempt** |
| 3.2.6 Consistent Help | A | Help entry points sit in **the same relative position** across the page set | The "feedback/contact" entry must not move between the three sites |
| 3.3.1 Error Identification | A | Errors must be **stated in text** and name the field | Form errors cannot rely on a red border alone |
| 3.3.3 Error Suggestion | AA | Known corrections must be offered | Give examples for email/format errors |
| 3.3.7 Redundant Entry | A | Do not ask for the same input twice in one flow | JoinByToken, invite, and feedback multi-step flows |
| 3.3.8 Accessible Authentication | AA | Authentication must not demand a cognitive test; password managers and paste must work | Sign-in/sign-up; no memory-only verification |
| 4.1.2 Name, Role, Value | A | A custom component's name/role/state is programmatically determinable | The main risk surface for hand-written components |
| 4.1.3 Status Messages | AA | Status messages must be exposed to assistive technology **without taking focus** | Copy success, submit results, PoW progress |

WCAG 2.2's `4.1.1 Parsing` is judged to yield no further benefit; report failures under `4.1.2`.

### 1.2 Three Hard Constraints (the intersection of three design systems)

1. **Graded feedback strength**: light toast auto-dismisses after 3s → inline error in place (fired on blur) → important failures use a dialog. **Never carry an important failure in a light toast.**
2. **An empty state must answer "why is it empty + what to do next"**, and **replace the component that would have rendered** (a table empty state replaces the header too, otherwise a screen reader reads the whole table first).
3. **Font sizes in rem, dimensions and hit areas in px, color only through CSS variables.** rem is the only Web equivalent of Apple's "text scales up to 200%".

---

## 2. Interaction Component Patterns (APG)

Every pattern's spec URL prefix is `https://www.w3.org/WAI/ARIA/apg/patterns/`.

### 2.1 Component → Pattern Mapping in This Project

| Existing component | Pattern to adopt | Required keyboard / ARIA |
|---|---|---|
| `ConfirmDialog` | **alertdialog** (destructive actions) / dialog | `role=alertdialog` + `aria-modal=true` + `aria-labelledby` + **required `aria-describedby`**; open moves focus in → Tab cycles → Esc closes → **focus returns to the trigger on close** |
| `Select` | **combobox** or **listbox** | `aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected`; DOM focus stays on the combobox; ↑↓ / Enter / Esc; the popup is not in the Tab sequence |
| `ImageLightbox` | dialog | Same as dialog-modal |
| `FeedbackFab` overlay | dialog | Same as above |
| `NumberInput` | **spinbutton** | Arrow keys change the value + focusable step buttons |
| `DevControlCenter` | disclosure | `role=button` + `aria-expanded`; Enter/Space toggles |
| Copy button / submit result | **status** | `role=status` (implicit `aria-live=polite`); **must not steal focus when the state updates** |

### 2.2 Pattern Quick Reference

**dialog / alertdialog**

- Focus moves in on open; for long content focus the title or a static element and add `tabindex="-1"`.
- `Tab` / `Shift+Tab` cycle within; `Escape` closes; on close **focus returns to the invoking element**.
- Use `aria-modal=true` **only when both conditions hold at once**: ① the code blocks all interaction with the outside ② it does visually cover the outside.
- Strongly recommended: a visible close control inside the Tab sequence.

**combobox**

- `Tab` enters (the popup and the indicator button are not in the Tab sequence); `Down` opens the popup; `Escape` closes; `Enter` accepts a suggestion.
- **Never intercept the browser's text-field editing keys** (especially important with a Chinese IME).
- `aria-autocomplete` = `none` / `list` / `both`.

**listbox**

- With `>5` items, `Home`/`End` are mandatory; with `>7` items, type-ahead is recommended.
- Each option carries `aria-selected` or `aria-checked` — **choose one**, consistently site-wide (convention: `selected` for single-select, `checked` for multi-select).
- Virtualized lists use `aria-setsize` / `aria-posinset`.

**tabs** (`RepoDetail` already uses this)

- `role=tablist` / `tab` / `tabpanel`; a tab needs `aria-controls`, a panel needs `aria-labelledby`.
- Horizontal tabs use `←/→`; **never listen for up/down arrows**; `Tab` lands on the active tab, and a second press leaves the tablist.
- **Automatic activation** is recommended when content is not delayed.

**alert / status**

- `role=alert` has no keyboard interaction, **must not affect focus**, and **must not be designed to auto-dismiss**.
- Non-urgent messages use `role=status`.
- Urgent messages that need a user response switch to alertdialog.

**tooltip**

- `role=tooltip` + `aria-describedby` on the trigger; only `Escape` dismisses it.
- **APG itself says the pattern has no task-force consensus yet** → do not put critical information in it.

---

## 3. Component Foundation Choice

### 3.1 Conclusion

**The main skeleton is shadcn/ui (`-b radix`), with React Aria Components backfilling the input-type components.**

4 of the 9 existing components land exactly on this stack's strengths, and all four are the kind that is "easiest to get wrong on accessibility":

| Existing | Migrate to |
|---|---|
| `Select` | Radix `Select` (keyboard, typeahead, Portal, scroll buttons — the full set) |
| `ConfirmDialog` | Radix `AlertDialog` (focus lands on Cancel by default, Esc/outside click closes, inert scrim) |
| `ImageLightbox` / `FeedbackFab` overlay | Radix `Dialog` / `Popover` |
| `NumberInput` | **React Aria `NumberField`** (the only one with zh-CN and CJK/IME handling built in) |
| `DiffView` / `Mascot` / `BackBar` / `DevControlCenter` | **Keep in-house** (no library covers them; forcing one on would only make them heavier) |

### 3.2 Why shadcn/ui + radix base

- shadcn/ui is **code distribution**, not a dependency: the source lands in the repo and afterwards belongs entirely to the project; changing styles or behavior needs no wrapper overrides.
- Official positioning, verbatim: "This is not a component library. It is how you build your component library."
- **radix rather than the default base**: since 2026-07 Base UI is the CLI default, but the project states plainly "Radix is not being deprecated… We still run it in production today and we're not migrating". Radix's 30 primitive APIs have been frozen-stable for years; for a small team, "switching base" is pure rewrite cost.
- MIT License, still active as of 2026-09.

### 3.3 How to use it

```bash
# 前置：Tailwind 必须先升到 v4（见 STACK.md §2.1）
npx shadcn@latest init -b radix
npx shadcn@latest add alert-dialog select dialog popover
npx shadcn@latest view dialog              # 先看源码再决定
npx shadcn@latest add dialog --dry-run --diff   # 落地前对 diff
```

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild><Button variant="outline">删除</Button></DialogTrigger>
  <DialogContent className="sm:max-w-sm">
    <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
    <DialogFooter><DialogClose asChild><Button>取消</Button></DialogClose></DialogFooter>
  </DialogContent>
</Dialog>
```

**Fixed order for introducing a new component**: `view` the source → `add --dry-run --diff` → land it → delete unused variants; keep no dead code.

### 3.4 Theme Tokens

shadcn names tokens semantically (surface / foreground in pairs); **switching themes touches only three places**:

| Token | Value in this project |
|---|---|
| `--primary` | Seal blue (the existing `--brand-500`) |
| `--ring` | Focus ring color (same family as primary) |
| `--radius` | Corner radius base (see §4.3) |

`popover` / `border` / `input` / `muted` and the rest all use semantic names; **never write a literal color such as `blue-600` inside a component**.

Radii derive from the base: `sm=0.6×` · `md=0.8×` · `lg=1×` · `xl=1.4×` · `2xl=1.8×` (default `--radius: 0.625rem`).

**Warning**: `components.json`'s `style` / `baseColor` / `cssVariables` **cannot be changed after init** (to change them you must delete and reinstall the components).

### 3.5 Rejected Options

| Option | Why not |
|---|---|
| **Headless UI as the workhorse** | Component surface too small (no Slider / NumberInput / DatePicker / Toast / Accordion); slowest release cadence (2.2.10 stuck at 2026-04); the `ui-*` variant system would create a second convention alongside `data-[state]` |
| **Plain Radix without shadcn** | The accessibility foundation is identical, but it loses the CLI / source distribution that makes "adding a component = one review" |
| **Ark UI as the workhorse** | Wider component surface but a small ecosystem; source-style distribution adds a layer of uncertainty to the Vite build chain. **Usable as a fallback**, to be re-evaluated when a large batch of complex components is needed |
| **React Aria Components site-wide** | The most capable, but all styling work falls to the project — over-investment for the current 9 components; adopted only locally, for input-type components |

### 3.6 Acceptance Bar for Landing

- Any interactive component must **complete its primary flow with the keyboard alone** (Tab in, Enter/Space to activate, Esc to close, arrow keys to navigate), and **return focus to the trigger on close**.
- An overlay must have a `Title` (visually hidden is fine, but it must be accessible); destructive actions use `AlertDialog` semantics rather than a plain Dialog.
- Component state is expressed only with `data-*` attributes; styling uses semantic tokens only.
- Any new token must supply both `:root` values and — if dark mode is ever supported — `.dark` values.

---

## 4. Visual Spec

### 4.1 Spacing

**The primary scale is multiples of 8: 8 / 16 / 24 / 32 / 48; 4 and 12 are allowed for fine-tuning; 20 is not used.**

| Context | Value |
|---|---|
| Card padding | 16 (compact) / 24 (regular) |
| Section spacing | 24 / 32 |
| Vertical spacing between form items | 16 |
| Between label and control | 4 – 8 |
| Horizontal padding inside a control | 12 (8 for small) |

Rationale: AntD uses a 4/8 system, Carbon uses 2/4/8, and this project already uses Tailwind (0.25rem = 4px base) — every value above maps directly onto an existing class name. 20 would break the visual rhythm of 8.

### 4.2 Type Size and Weight

| Use | Size / line height |
|---|---|
| Body | **14 / 22** |
| Secondary information | 12 / 20 |
| Subheading | 16 / 24 |
| Headings H3 / H4 | 24 / 32 · 20 / 28 |
| Headings H1 / H2 | 38 / 46 · 30 / 38 |

- **Keep the site-wide type scale to 3–5 steps.**
- **Use only weights 400 and 500** (600 for emphasis).
- Numbers always `font-variant-numeric: tabular-nums`.
- Body-on-background contrast target **7:1 (AAA)**, never below 4.5:1.

Rationale: AntD's 14/22 is calibrated for Chinese on-screen reading (50cm viewing distance). M3's body-large 16/24 and Apple's 17pt target Latin letterforms; a Chinese glyph carries more information of its own, so 14px fits more onto the screen.

**Line-height formula**: `size + 8` (the AntD system). Latin/numeric-only paragraphs may use 1.5×.

### 4.3 Corner Radius

| Use | Value |
|---|---|
| Card / overlay | 8 |
| Input / button | 6 |
| Tag / small badge | 4 |
| Avatar | full |

Follows AntD's base-6 system (= Tailwind `rounded-md` / `rounded-lg`). M3's 12/16/28 is on the large side for a dense admin surface; only the relaxed portal/forum scenarios may go up to 12.

### 4.4 Control Sizes and Touch Targets

| Context | Value |
|---|---|
| Desktop control height | **32** (24 in dense spots) |
| Mobile / tablet controls | **≥44** |
| Hit area of an icon-only button | **≥44×44** (expanded with invisible padding; visual size unchanged) |
| Absolute floor | **24×24** (WCAG 2.5.8; where smaller, 24px-diameter circles must not intersect) |

With a desktop pointer, AntD's 32 is enough and saves vertical space; touch follows Apple's (44pt) and M3's (48dp) floors. Hit-area expansion follows M3's `minimumInteractiveComponentSize` idea, at zero visual cost.

### 4.5 Motion

| Context | Duration |
|---|---|
| hover / focus | 100ms |
| Enter / exit | 200ms |
| Drawer / modal | 300ms |

**Keep exactly one easing curve site-wide**, pick one of:

- M3 emphasized: `cubic-bezier(.2, 0, 0, 1)`
- AntD easeOut: `cubic-bezier(.215, .61, .355, 1)`

Anything past 400ms feels sluggish in an admin surface. `prefers-reduced-motion` must be respected.

### 4.6 State Layers and Loading

**Interactive states layer state opacity uniformly** (the M3 system); no separately computed hover/active colors for seal blue:

| State | Opacity |
|---|---|
| hover | 0.08 |
| focus / pressed | 0.12 |
| dragged | 0.16 |

**Loading**: tables/lists use a **skeleton** (Carbon is explicit that "table loading uses a skeleton, not a spinner"); any operation over **2s** must show loading or a progress indicator; long tasks offer cancellation.

### 4.7 Color

- Semantic colors: `primary` / `success` / `warning` / `error` / `info` — **use role names, not color names**.
- Neutrals in three levels: primary text, secondary text, disabled and placeholder.
- **All color goes through CSS variables**; hard-coded hex is banned (`CONVENTIONS.md` §1 already enforces this).
- A single light theme (seal blue on white); no dark mode.

---

## 5. Chinese Typography

Based on W3C **clreq** (Requirements for Chinese Text Layout) and GB/T 15834—2011.

| Item | Rule |
|---|---|
| **Line height (行高)** | clreq: leading is 50%–100% of the type size, i.e. `line height = size × 1.5–2.0`. WCAG 1.4.12 requires surviving a user override to ≥1.5× |
| **First-line indent (段首缩排)** | **2em** is the standard for Chinese publications. **For UI text, 0 indent + paragraph spacing is recommended**; long-form body text uses 2em. Do not mix the two conventions |
| **Punctuation (标点)** | Inline punctuation occupies 1em; its width may be compressed, on the principle of "squeeze in first, push out later" (先挤进，后推出) |
| **Line-breaking rules (禁则)** | clreq's four levels: `none` / **`basic` (recommended)** / `GB` / `strict`. The CSS counterpart is `line-break: strict` (when tightening) |
| **Orphan avoidance (孤字)** | clreq states plainly that "no orphan character on a line, no orphan line on a page" (孤字不成行、孤行不成页). On the Web: body text uses `text-wrap: pretty`; headings use `text-wrap: balance` (**applies to a limited number of lines only**: Chromium ≤6 lines) |
| **CJK–Latin mixed setting (中西混排)** | In horizontal writing, a Latin word must not be broken across two lines; `word-break: break-all` breaks this convention, so Chinese body text uses the default `normal` |
| **Numbers (数字)** | `tabular-nums` guarantees vertical alignment |

> **A live instance in this project**: the portal hero headline "把想法写成代码。" ("write ideas into code") wraps onto three lines at ≥1280px and leaves the orphan character "码。" (see `REFACTOR.md` §8 #2). This is exactly the problem that `text-wrap: balance` or a lower size cap should solve.

---

## 6. State and Feedback Patterns

### 6.1 Forms

| Rule | Basis |
|---|---|
| Labels are **always top-aligned**, 1–3 words, no colon | Carbon (its only default layout) |
| Mark required / optional **only for the minority** (when most fields are required, mark only optional) | Carbon |
| A placeholder holds a format example only — **never critical information** | Carbon |
| Helper copy: short goes below the input, long uses ⓘ + tooltip | AntD |
| **Validation fires on blur, errors show inline next to the field**; the copy must be specific | Carbon + AntD agree |
| Errors must be **stated in text** and name the field; a red border alone is not enough | WCAG 3.3.1 |
| Radio: 2–5 options use a RadioGroup, **>5 use a select** | AntD |
| A switch **takes effect immediately**, with no submit button | AntD |
| File upload must state the size and format (e.g. "up to 5M, PDF/ZIP") and show progress | AntD |
| Wizard/dialog buttons are **right-aligned** (primary on the right); an in-page form's primary button is left-aligned | Carbon |
| Button copy uses a **specific action** ("Create repository") rather than "Submit" | Carbon |
| Do not ask for the same input twice in one flow | WCAG 3.3.7 |

**Form page layout gradient** (AntD): basic single column → weak grouping → task decomposition (stepped) → scenario-specific.

### 6.2 Empty States

- Three elements: **graphic element + explicit reason + suggested action** (AntD).
- **Must replace the component that would have rendered** — a table empty state replaces the header and footer too (Carbon).
- Elements are **left-aligned as a block**; where space is tight, use plain text.
- With several empty states on one screen, switch to tertiary buttons; **offer only one primary action at a time**.
- Copy uses **positive phrasing** ("从添加第一条数据开始" ("start by adding your first record") beats "你还没有数据" ("you have no data yet")).

### 6.3 Loading and Errors

| Scenario | Approach |
|---|---|
| Table / list loading | skeleton |
| Operation >2s | loading or a progress indicator; long tasks offer cancellation |
| Light toast | auto-dismisses after 3s |
| Important failure | **must use a dialog**; light toasts are banned |
| Network error | show in place + a retry entry point; no full-page blank screen |

### 6.4 Tables

- An empty cell shows `-`.
- Time, status, and action columns **do not wrap**.
- **The header row height must match the data rows** (Carbon).
- Row hover is always on (even when the row is not clickable).
- ≤5 inline row actions; anything more goes into an overflow.
- Pagination is pinned to the bottom of the table.

---

## 7. Landing Checklist

Check against this before changing UI; walk it item by item in PR review.

**Accessibility**

- [ ] Text contrast ≥4.5:1, large text ≥3:1, UI borders and icons ≥3:1
- [ ] Primary flows completable with the keyboard; focus indicator visible (2px + 3:1)
- [ ] Overlays: focus moves in → cycles → Esc closes → focus returns
- [ ] Icon buttons have accessible names; hit areas ≥24×24 (44×44 recommended)
- [ ] Form errors are textual, name the field, and suggest a fix
- [ ] Status messages use `role=status` and do not steal focus
- [ ] No horizontal scrolling at 320 CSS px wide
- [ ] Fixed-height containers changed to `min-height`

**Chinese typography**

- [ ] Body 14/22, line height = size + 8
- [ ] Headings use `text-wrap: balance`, long body text uses `text-wrap: pretty`
- [ ] No orphan characters, no broken CJK–Latin line breaks
- [ ] Numbers use `tabular-nums`

**Visual consistency**

- [ ] Spacing in multiples of 8 (8/16/24/32/48), no 20
- [ ] Radius: card 8 / control 6 / tag 4
- [ ] Color goes through CSS variables, no hard-coded hex
- [ ] Interactive states use state-layer opacity (hover .08 / pressed .12)
- [ ] Motion durations 100/200/300ms, one easing curve site-wide

**Component conventions**

- [ ] No new native `<select>` or `window.confirm()`
- [ ] New components follow shadcn's `view` → `add --dry-run --diff` flow
- [ ] Destructive actions use `AlertDialog` semantics
- [ ] Component state uses `data-*` attributes

---

## 8. Official Documentation Sources

**Standards**

- WCAG 2.2 (REC): https://www.w3.org/TR/WCAG22/
- WCAG 2.2 Quick Reference: https://www.w3.org/WAI/WCAG22/quickref/
- Understanding (per criterion): https://www.w3.org/WAI/WCAG22/Understanding/
- WAI-ARIA APG: https://www.w3.org/WAI/ARIA/apg/patterns/
- WAI-ARIA specification: https://w3c.github.io/aria/
- clreq, Requirements for Chinese Text Layout: https://www.w3.org/TR/clreq/
- CSS Text L3 / L4: https://www.w3.org/TR/css-text-3/ · https://www.w3.org/TR/css-text-4/
- WAI Forms tutorial: https://www.w3.org/WAI/tutorials/forms/validation/

**Design systems**

- Ant Design spec: https://ant.design/docs/spec/values-cn · [Layout](https://ant.design/docs/spec/layout-cn) · [Font](https://ant.design/docs/spec/font-cn) · [Data entry](https://ant.design/docs/spec/data-entry-cn) · [Feedback](https://ant.design/docs/spec/feedback-cn) · [Empty state](https://ant.design/docs/spec/research-empty-cn)
- Material Design 3: https://m3.material.io/styles/typography/type-scale-tokens · [State layers](https://m3.material.io/foundations/interaction/states/overview) · [Official token source](https://github.com/material-components/material-web/tree/main/tokens/versions/v0_192)
- Apple HIG: [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
- IBM Carbon: [Spacing](https://carbondesignsystem.com/elements/spacing/overview/) · [Forms](https://carbondesignsystem.com/patterns/forms-pattern/) · [Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/) · [Data table](https://carbondesignsystem.com/components/data-table/usage/)

**Component libraries**

- shadcn/ui: [Docs](https://ui.shadcn.com/docs) · [Theming](https://ui.shadcn.com/docs/theming) · [CLI](https://ui.shadcn.com/docs/cli)
- Radix Primitives: [Overview](https://www.radix-ui.com/primitives/docs/overview/introduction) · [Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility) · [Styling](https://www.radix-ui.com/primitives/docs/guides/styling)
- React Aria: [Quality and i18n](https://react-aria.adobe.com/quality) · [Styling](https://react-aria.adobe.com/styling)

---

## 9. Open Items

| Item | Notes |
|---|---|
| Tailwind v4 prerequisite | shadcn/ui's current docs and CLI default to Tailwind v4; Tailwind 3.4 goes through the legacy docs. **Tailwind must be upgraded first** (see STACK.md §2.1), otherwise components can only be copied by hand |
| Focus ring color | Must hit 3:1 against seal blue while staying unmistakable from primary; to be settled by measurement |
| Touch targets vs. desktop density | Forum lists and admin tables are where 2.5.8 bites most; during the refactor every 24px circle must be checked for intersection |
| `prefers-reduced-motion` | The existing `index.css` already has a `@media (prefers-reduced-motion: reduce)` branch; after the refactor, confirm every new animation is covered |
