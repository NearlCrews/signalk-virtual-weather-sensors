import type { CSSProperties } from 'react';

// Design tokens for the federated config panel.
//
// The panel renders inside the Signal K admin UI, which is Bootstrap 5.3 and
// flips between light and dark via `data-bs-theme` on a host element. Inline
// styles cannot read that theme, so every color here references a `--svws-*`
// CSS custom property instead of a hex literal. THEME_STYLE (below) defines
// those properties once on `.svws-panel` with explicit light values, then
// overrides them for dark mode. Components stay theme-agnostic: they read
// tokens, the theme layer redefines them. A new hex literal in a component is
// a defect.
//
// Theme pinning: a `data-svws-theme` attribute on the `.svws-panel` root
// (set by ThemeToggle, persisted under localStorage key `svws-theme`) pins
// light, dark, or the red-preserving night theme regardless of the host.
// The pinned blocks share specificity (0,2,0) with the host-driven dark
// block and are emitted later in the stylesheet, so a pinned choice wins.

// Scale tokens: theme-independent, defined once on the root. Radii and font
// sizes sit on Bootstrap 5.3 defaults so the panel reads native inside the
// admin shell. The spacing tokens cover the common 8/12/16 gutters; a few
// component-specific sizes (card padding, icon dimensions) stay as literal
// pixels in the S map below where no shared step applies.
const SCALE_TOKENS = `
  --svws-radius: 6px;
  --svws-radius-sm: 4px;
  --svws-radius-pill: 999px;
  --svws-font-body: 14px;
  --svws-font-small: 12px;
  --svws-font-title: 15px;
  --svws-font-stat: 22px;
  --svws-space-1: 8px;
  --svws-space-2: 12px;
  --svws-space-3: 16px;
`;

// Light theme. Cards must read white so they stand out from the admin's gray
// page background. Muted text is #555555: 7.46:1 on white and 6.77:1 on the
// raised surface; faint text is #62687a: 5.55:1 on white and 5.05:1 on the
// raised surface. Both clear WCAG AA (4.5:1) everywhere they appear at small
// sizes. color-scheme rides along with each token block so native widgets
// (checkboxes, number spinners, scrollbars) follow the panel theme even when
// it is pinned against the host.
const LIGHT_TOKENS = `
  color-scheme: light;
  --svws-bg: #e4e5e6;
  --svws-surface: #ffffff;
  --svws-surface-muted: #f8f9fa;
  --svws-surface-raised: #f3f4f6;
  --svws-border: #e0e0e0;
  --svws-text: #333333;
  --svws-text-muted: #555555;
  --svws-text-faint: #62687a;
  --svws-accent: #3b82f6;
  --svws-accent-text: #ffffff;
  --svws-ok: #22c55e;
  --svws-wait: #f59e0b;
  --svws-off: #9ca3af;
  --svws-danger-bg: #fef2f2;
  --svws-danger-fg: #991b1b;
  --svws-danger-border: #fca5a5;
  --svws-warn-bg: #fef3c7;
  --svws-warn-fg: #78350f;
  --svws-warn-border: #fbbf24;
  --svws-success-bg: #ecfdf5;
  --svws-success-fg: #065f46;
  --svws-success-border: #6ee7b7;
  --svws-info-bg: #eef2ff;
  --svws-info-fg: #3730a3;
  --svws-info-border: #c7d2fe;
`;

// Dark theme. Muted text is #a3a9b5: 5.38:1 on the raised surface and 6.21:1
// on the card surface; faint text is #9aa1ad: 4.88:1 on the raised surface
// and 5.63:1 on the card surface. AA holds on every dark background either
// appears on.
const DARK_TOKENS = `
  color-scheme: dark;
  --svws-bg: #1b1c22;
  --svws-surface: #262833;
  --svws-surface-muted: #20212b;
  --svws-surface-raised: #30323f;
  --svws-border: #3a3c4a;
  --svws-text: #e6e7ea;
  --svws-text-muted: #a3a9b5;
  --svws-text-faint: #9aa1ad;
  --svws-accent: #4c93ff;
  --svws-accent-text: #ffffff;
  --svws-ok: #2dd4a0;
  --svws-wait: #fbbf24;
  --svws-off: #6b7785;
  --svws-danger-bg: #3a1a1a;
  --svws-danger-fg: #f5a3a3;
  --svws-danger-border: #7a3a3a;
  --svws-warn-bg: #3a2f12;
  --svws-warn-fg: #f5d28a;
  --svws-warn-border: #6b551f;
  --svws-success-bg: #12352a;
  --svws-success-fg: #7fe3c0;
  --svws-success-border: #2f6b54;
  --svws-info-bg: #1e2547;
  --svws-info-fg: #a9b6f0;
  --svws-info-border: #3a4577;
`;

// Night theme: red-preserving for night vision at the helm. Near-black
// surfaces, every text and accent token collapses into the desaturated red
// and amber families, nothing renders blue, green, or white. Contrast checked
// against the night surfaces: text 7.25:1, muted 5.13:1, faint 4.56:1 worst
// case, every status fg 5.65:1 or better on its paired bg.
const NIGHT_TOKENS = `
  color-scheme: dark;
  --svws-bg: #0d0606;
  --svws-surface: #160a0a;
  --svws-surface-muted: #110808;
  --svws-surface-raised: #1f0e0e;
  --svws-border: #3a1616;
  --svws-text: #e08a8a;
  --svws-text-muted: #b87474;
  --svws-text-faint: #ad6c6c;
  --svws-accent: #cf6a3c;
  --svws-accent-text: #1a0808;
  --svws-ok: #cf8a4a;
  --svws-wait: #a9742e;
  --svws-off: #7a4f4f;
  --svws-danger-bg: #2a0d0d;
  --svws-danger-fg: #e07a6a;
  --svws-danger-border: #6e2a2a;
  --svws-warn-bg: #241204;
  --svws-warn-fg: #d9a05a;
  --svws-warn-border: #6e4a1f;
  --svws-success-bg: #1d0f08;
  --svws-success-fg: #cf8a5a;
  --svws-success-border: #6e3f1f;
  --svws-info-bg: #200c0c;
  --svws-info-fg: #c98080;
  --svws-info-border: #5e2a2a;
`;

// Injected once by PluginConfigurationPanel. Covers the token contract, the
// host-driven dark overrides, the pinned theme blocks, the :focus-visible
// ring, and the pointer affordances (inline styles cannot express
// pseudo-classes or media queries). Order matters: the pinned
// `[data-svws-theme]` blocks come after the host-driven dark block so an
// explicit user choice outranks the host theme at equal specificity.
export const THEME_STYLE = `
.svws-panel {
${SCALE_TOKENS}${LIGHT_TOKENS}}
[data-bs-theme="dark"] .svws-panel,
.dark-mode .svws-panel {
${DARK_TOKENS}}
.svws-panel[data-svws-theme="light"] {
${LIGHT_TOKENS}}
.svws-panel[data-svws-theme="dark"] {
${DARK_TOKENS}}
.svws-panel[data-svws-theme="night"] {
${NIGHT_TOKENS}}
.svws-panel input:focus-visible,
.svws-panel select:focus-visible,
.svws-panel button:focus-visible,
.svws-panel a:focus-visible {
  outline: 2px solid var(--svws-accent);
  outline-offset: 1px;
}
/* Buttons set their background as an inline style, which outranks the
   browser's default disabled appearance, so a disabled button would still
   look enabled. !important is required to override the inline style for the
   disabled state. */
.svws-panel button:disabled,
.svws-panel button[aria-disabled="true"] {
  background: var(--svws-surface-raised) !important;
  color: var(--svws-text-faint) !important;
  border-color: var(--svws-border) !important;
  cursor: not-allowed !important;
}
/* Pointer feedback. Inline styles cannot express :hover or :active, so the
   interactive elements get a shared brightness response here, with a short
   transition so the shift reads as a response rather than a flicker.
   Disabled buttons opt out. */
.svws-panel input,
.svws-panel select {
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.svws-panel button {
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    filter 120ms ease;
}
.svws-panel button:hover:not(:disabled):not([aria-disabled="true"]) {
  filter: brightness(0.96);
}
.svws-panel button:active:not(:disabled):not([aria-disabled="true"]) {
  filter: brightness(0.9);
}
/* Disclosure chevron rotation. The transition lives in CSS (not the inline
   style) so reduced-motion users can opt out below. */
.svws-panel .svws-chevron {
  transition: transform 0.15s ease;
}
@media (prefers-reduced-motion: reduce) {
  .svws-panel .svws-chevron {
    transition: none;
  }
}
`;

// Shared bases for style pairs that differ only in a couple of declarations.
// Spread into the named entries below so the pairs cannot drift apart.

// Text inputs: the API key field stretches, the number fields stay compact.
const inputBase = {
  minHeight: 36,
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: 'var(--svws-font-body)',
  border: '1px solid var(--svws-border)',
  borderRadius: 'var(--svws-radius)',
  background: 'var(--svws-surface)',
  color: 'var(--svws-text)',
} satisfies CSSProperties;

// Footer save-outcome line: success and error differ only in color.
const actionBase = {
  fontSize: 'var(--svws-font-small)',
  marginLeft: 8,
} satisfies CSSProperties;

// Key-test result line: success and error differ only in color.
const testResultBase = {
  fontSize: 'var(--svws-font-small)',
  minHeight: 18,
  margin: '0 0 8px',
} satisfies CSSProperties;

const checkboxLabelBase = {
  fontSize: 'var(--svws-font-body)',
} satisfies CSSProperties;

// Buttons: primary and secondary differ only in fill, text, and border.
const btnBase = {
  padding: '8px 16px',
  minHeight: 36,
  borderRadius: 'var(--svws-radius)',
  fontSize: 'var(--svws-font-body)',
  cursor: 'pointer',
} satisfies CSSProperties;

// Segmented-control button (the theme toggle); the active variant spreads
// this and fills with the accent.
const segmentedBtn = {
  padding: '6px 12px',
  minHeight: 36,
  background: 'transparent',
  color: 'var(--svws-text-muted)',
  border: 'none',
  fontSize: 'var(--svws-font-small)',
  cursor: 'pointer',
} satisfies CSSProperties;

// `satisfies` (not a key-erasing annotation) so a typo'd S.<key> reference in
// a component fails the compile instead of resolving to undefined.
export const S = {
  // The root paints --svws-bg itself: a pinned Dark or Night theme must read
  // as one continuous surface, not dark cards floating on the host's light
  // page (and the sticky footer reuses the same background).
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: 'var(--svws-text)',
    background: 'var(--svws-bg)',
    padding: 'var(--svws-space-3)',
    borderRadius: 'var(--svws-radius)',
  },
  // Top control row: section heading space on the left, theme toggle on the
  // right.
  controlBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 'var(--svws-space-1)',
    marginBottom: 'var(--svws-space-2)',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    background: 'var(--svws-surface)',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
    marginBottom: 'var(--svws-space-2)',
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 'var(--svws-radius)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    flexShrink: 0,
    background: 'var(--svws-accent)',
    color: 'var(--svws-accent-text)',
  },
  cardInfo: { flex: 1, minWidth: 160 },
  cardTitle: {
    fontSize: 'var(--svws-font-title)',
    fontWeight: 600,
    color: 'var(--svws-text)',
  },
  cardMeta: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-faint)',
    marginTop: 2,
  },
  stateGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  dotOk: { background: 'var(--svws-ok)' },
  dotErr: { background: 'var(--svws-danger-fg)' },
  dotOff: { background: 'var(--svws-off)' },
  dotLabel: { fontSize: 'var(--svws-font-small)', color: 'var(--svws-text-muted)' },
  staleMarker: {
    marginLeft: 'auto',
    color: 'var(--svws-text-faint)',
    fontSize: 'var(--svws-font-small)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 'var(--svws-space-1)',
    marginBottom: 'var(--svws-space-3)',
  },
  statCard: {
    padding: '12px 14px',
    background: 'var(--svws-surface)',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
  },
  statValue: {
    fontSize: 'var(--svws-font-stat)',
    fontWeight: 700,
    color: 'var(--svws-text)',
    lineHeight: 1.1,
  },
  statLabel: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-faint)',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minHeight: 36,
    padding: '8px 12px',
    background: 'var(--svws-surface-muted)',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
    cursor: 'pointer',
    fontSize: 'var(--svws-font-body)',
    fontWeight: 600,
    color: 'var(--svws-text)',
    textAlign: 'left',
    marginTop: 'var(--svws-space-2)',
  },
  sectionSummary: {
    marginLeft: 'auto',
    fontWeight: 400,
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-muted)',
  },
  chevron: {
    display: 'inline-block',
    fontSize: 10,
    color: 'var(--svws-text-faint)',
    flexShrink: 0,
  },
  sectionBody: { padding: '10px 4px 2px' },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--svws-space-2)',
    marginBottom: 'var(--svws-space-1)',
    flexWrap: 'wrap',
  },
  // flex-basis with shrink allowed: labels align in a column on wide screens
  // but give the space back on narrow ones instead of forcing a dead gutter.
  label: {
    fontSize: 'var(--svws-font-body)',
    color: 'var(--svws-text-muted)',
    flex: '0 1 240px',
  },
  input: {
    ...inputBase,
    flex: 1,
    minWidth: 160,
  },
  inputNumber: {
    ...inputBase,
    width: 110,
  },
  unitsHint: {
    fontSize: 'var(--svws-font-body)',
    color: 'var(--svws-text-muted)',
  },
  help: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-faint)',
    lineHeight: 1.45,
    margin: '0 0 12px',
  },
  // 22px hit area for marine use: a 16px checkbox is too small for wet
  // fingers on a moving boat. accentColor keeps the checked fill on the
  // token palette.
  checkbox: {
    width: 22,
    height: 22,
    flexShrink: 0,
    cursor: 'pointer',
    accentColor: 'var(--svws-accent)',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  checkboxLabel: {
    ...checkboxLabelBase,
    color: 'var(--svws-text)',
    cursor: 'pointer',
  },
  // Emphasized checkbox label (the notifications master toggle): the base
  // label plus a 600 weight, so the weight stays a token-defined value rather
  // than a magic number inlined in a component.
  checkboxLabelStrong: {
    ...checkboxLabelBase,
    color: 'var(--svws-text)',
    cursor: 'pointer',
    fontWeight: 600,
  },
  // Disabled sub-toggle labels keep the faint token (AA-compliant in every
  // palette) instead of stacking opacity on a muted color, so they stay
  // readable while the master toggle is off.
  checkboxLabelDisabled: {
    ...checkboxLabelBase,
    color: 'var(--svws-text-faint)',
    cursor: 'not-allowed',
  },
  fieldset: {
    margin: '4px 0 0',
    padding: '4px 12px 8px',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
  },
  legend: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-muted)',
    padding: '0 6px',
  },
  btnPrimary: {
    ...btnBase,
    background: 'var(--svws-accent)',
    color: 'var(--svws-accent-text)',
    border: 'none',
    fontWeight: 600,
  },
  btnSecondary: {
    ...btnBase,
    background: 'var(--svws-surface-raised)',
    color: 'var(--svws-text)',
    border: '1px solid var(--svws-border)',
  },
  // Sticky action bar pinned to the bottom of the viewport so Save, Discard,
  // and the dirty indicator stay reachable above a long section list. The
  // panel background fills behind it so content scrolling underneath does not
  // show through.
  footer: {
    position: 'sticky',
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--svws-space-1)',
    padding: 'var(--svws-space-2) 0',
    borderTop: '1px solid var(--svws-border)',
    marginTop: 'var(--svws-space-3)',
    background: 'var(--svws-bg)',
    zIndex: 5,
  },
  dirty: {
    color: 'var(--svws-warn-fg)',
    fontSize: 'var(--svws-font-small)',
    marginLeft: 8,
  },
  actionOk: {
    ...actionBase,
    color: 'var(--svws-success-fg)',
  },
  actionErr: {
    ...actionBase,
    color: 'var(--svws-danger-fg)',
  },
  testResultOk: {
    ...testResultBase,
    color: 'var(--svws-success-fg)',
  },
  testResultErr: {
    ...testResultBase,
    color: 'var(--svws-danger-fg)',
  },
  errorBanner: {
    color: 'var(--svws-danger-fg)',
    background: 'var(--svws-danger-bg)',
    border: '1px solid var(--svws-danger-border)',
    borderRadius: 'var(--svws-radius)',
    padding: '8px 12px',
    fontSize: 'var(--svws-font-body)',
    margin: '0 0 12px',
  },
  // First-run callout: info-colored so it reads as guidance, not an error.
  callout: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    background: 'var(--svws-info-bg)',
    border: '1px solid var(--svws-info-border)',
    color: 'var(--svws-info-fg)',
    borderRadius: 'var(--svws-radius)',
    padding: '12px 16px',
    margin: '0 0 12px',
    fontSize: 'var(--svws-font-body)',
    lineHeight: 1.45,
  },
  link: { color: 'var(--svws-accent)' },
  // Segmented control (the theme toggle). Buttons share a bordered container;
  // the active segment fills with the accent. 36px segments for marine touch
  // use.
  segmented: {
    display: 'inline-flex',
    // Rendered as a <fieldset>: zero out the user-agent margin and padding so
    // the segments sit flush inside the border.
    margin: 0,
    padding: 0,
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
    overflow: 'hidden',
    background: 'var(--svws-surface)',
  },
  segmentedBtn,
  segmentedBtnActive: {
    ...segmentedBtn,
    background: 'var(--svws-accent)',
    color: 'var(--svws-accent-text)',
    fontWeight: 600,
  },
  // Merge composition list. One bordered row per provider: the include
  // checkbox and label on the left, the reorder controls on the right. A row
  // wraps on narrow widths so the reorder buttons drop below the label rather
  // than overflow.
  mergeRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    minHeight: 36,
    padding: '6px 10px',
    background: 'var(--svws-surface)',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
    marginBottom: 'var(--svws-space-1)',
  },
  // The checkbox-plus-label cluster grows to fill the row so the reorder
  // controls sit flush right.
  mergeRowMain: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 160,
  },
  // Reorder button pair, pinned right.
  mergeReorder: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  // Compact square reorder button. Keeps the 36px marine hit area while
  // staying narrow enough for two side by side. The glyph is the accessible
  // name's icon; the real label rides on aria-label.
  reorderBtn: {
    width: 36,
    minHeight: 36,
    padding: 0,
    background: 'var(--svws-surface-raised)',
    color: 'var(--svws-text)',
    border: '1px solid var(--svws-border)',
    borderRadius: 'var(--svws-radius)',
    fontSize: 'var(--svws-font-body)',
    cursor: 'pointer',
  },
  // "(primary)" badge on the first included provider. Accent-filled pill so it
  // reads as a role marker, not a status.
  primaryBadge: {
    display: 'inline-block',
    padding: '1px 8px',
    background: 'var(--svws-accent)',
    color: 'var(--svws-accent-text)',
    borderRadius: 'var(--svws-radius-pill)',
    fontSize: 'var(--svws-font-small)',
    fontWeight: 600,
    flexShrink: 0,
  },
  // Inline "needs a key" note on the disabled AccuWeather row. The faint
  // token, AA in every palette, so it stays readable beside the dimmed label.
  mergeNote: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-faint)',
    flexShrink: 0,
  },
  // Heading above the excluded rows: tells the operator a newly-checked
  // provider lands at the bottom of the order (and so is not the primary). The
  // muted token, with a small top gap to separate it from the included rows.
  mergeAvailableHint: {
    fontSize: 'var(--svws-font-small)',
    color: 'var(--svws-text-muted)',
    margin: 'var(--svws-space-1) 0 var(--svws-space-1)',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
} satisfies Record<string, CSSProperties>;
