import { describe, expect, it } from 'vitest';
import { RollingRequestWindow } from '../../../services/quota/RollingRequestWindow.js';

const HOUR = 60 * 60 * 1000;

describe('RollingRequestWindow', () => {
  it('counts cumulative and last-24h within one hour', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    w.record(0);
    expect(w.cumulativeCount()).toBe(2);
    expect(w.countLast24h(0)).toBe(2);
  });
  it('ages requests out of the 24h window but keeps the cumulative count', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    // 24 hours later the bucket has rotated out of the window.
    expect(w.countLast24h(24 * HOUR)).toBe(0);
    expect(w.cumulativeCount()).toBe(1);
  });
  it('zeros the window on a backward clock jump', () => {
    const w = new RollingRequestWindow(10 * HOUR);
    w.record(10 * HOUR);
    expect(w.countLast24h(5 * HOUR)).toBe(0);
  });
  it('keeps requests from the last 23 hours in the window', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    expect(w.countLast24h(23 * HOUR)).toBe(1);
  });
});
