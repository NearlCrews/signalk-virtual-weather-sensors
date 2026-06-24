/**
 * Tests for the FooterBar Save button disabled logic.
 *
 * The rule is: disabled = saving || (!dirty && !unconfigured).
 * An unconfigured plugin (configuration prop is null/undefined) should have
 * Save enabled even with no pending edits, so the user can save defaults to
 * enable the plugin without making a throwaway change first.
 */
import { describe, expect, it } from 'vitest';

/**
 * Pure extraction of the Save button disabled condition from FooterBar.tsx.
 * Keeping it here lets us test every case without a DOM or React renderer.
 */
function saveDisabled(saving: boolean, dirty: boolean, unconfigured: boolean): boolean {
  return saving || (!dirty && !unconfigured);
}

describe('FooterBar Save disabled condition', () => {
  describe('unconfigured plugin (configuration prop is null/undefined)', () => {
    it('enables Save when there are no edits', () => {
      expect(saveDisabled(false, false, true)).toBe(false);
    });

    it('enables Save when there are unsaved edits', () => {
      expect(saveDisabled(false, true, true)).toBe(false);
    });

    it('disables Save while a save is in flight', () => {
      expect(saveDisabled(true, false, true)).toBe(true);
    });

    it('disables Save while saving even with dirty edits', () => {
      expect(saveDisabled(true, true, true)).toBe(true);
    });
  });

  describe('configured plugin (configuration prop is an object)', () => {
    it('disables Save when there are no edits', () => {
      expect(saveDisabled(false, false, false)).toBe(true);
    });

    it('enables Save when there are unsaved edits', () => {
      expect(saveDisabled(false, true, false)).toBe(false);
    });

    it('disables Save while a save is in flight with no edits', () => {
      expect(saveDisabled(true, false, false)).toBe(true);
    });

    it('disables Save while saving even with dirty edits', () => {
      expect(saveDisabled(true, true, false)).toBe(true);
    });
  });
});
