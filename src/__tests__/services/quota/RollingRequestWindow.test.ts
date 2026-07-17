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
    // At the exact 24-hour boundary the request leaves the window.
    expect(w.countLast24h(24 * HOUR)).toBe(0);
    expect(w.cumulativeCount()).toBe(1);
  });
  it('retains the window conservatively on a backward clock jump', () => {
    const w = new RollingRequestWindow(10 * HOUR);
    w.record(10 * HOUR);
    expect(w.countLast24h(5 * HOUR)).toBe(1);
  });
  it('keeps requests from the last 23 hours in the window', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    expect(w.countLast24h(23 * HOUR)).toBe(1);
  });
  it('keeps a request until its exact 24-hour boundary', () => {
    const w = new RollingRequestWindow(0);
    w.record(59 * 60 * 1000);
    expect(w.countLast24h(24 * HOUR)).toBe(1);
    expect(w.countLast24h(24 * HOUR + 59 * 60 * 1000)).toBe(0);
  });
  it('atomically refuses a reservation at the limit', () => {
    const w = new RollingRequestWindow(0);
    expect(w.tryAcquire(1, 0)).toBe(true);
    expect(w.tryAcquire(1, 1)).toBe(false);
    expect(w.cumulativeCount()).toBe(1);
  });
});
