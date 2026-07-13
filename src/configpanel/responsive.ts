/**
 * Responsive layout rules for the configuration panel.
 *
 * Inline React styles cannot express media queries, so narrow-display rules
 * live in this focused stylesheet fragment and are injected with the theme.
 */
export const RESPONSIVE_STYLE = `
@media (max-width: 600px) {
  .svws-panel {
    padding: var(--svws-space-1) !important;
  }
  .svws-panel .svws-status-card {
    align-items: flex-start !important;
    padding: var(--svws-space-2) !important;
  }
  .svws-panel .svws-card-info {
    min-width: 0 !important;
    flex-basis: calc(100% - 60px) !important;
  }
  .svws-panel .svws-stale-marker {
    width: 100%;
    margin-left: 58px !important;
  }
  .svws-panel .svws-section-header {
    align-items: flex-start !important;
    flex-wrap: wrap !important;
  }
  .svws-panel .svws-section-summary {
    width: 100%;
    margin-left: 18px !important;
    text-align: left;
  }
}
`;
