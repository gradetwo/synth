/**
 * Schema versioning and migration tests.
 *
 * The failure this guards against is silent: a document written by one build and
 * read by another loses fields without saying so. The fixtures below are the
 * shapes older builds actually wrote (bare, unversioned JSON and a bare array),
 * and the assertions are about *nothing going missing*.
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, mergeKnown, unwrap, wrap } from './persist';

describe('schema envelope', () => {
  it('wraps with the current schema and unwraps it again', () => {
    const envelope = wrap({ hello: 'world' });
    expect(envelope.schema).toBe(SCHEMA_VERSION);
    expect(unwrap(envelope)).toEqual({ schema: SCHEMA_VERSION, data: { hello: 'world' } });
  });

  it('reads a payload written before versioning as schema 0', () => {
    expect(unwrap({ params: { 1: 1 } })).toEqual({ schema: 0, data: { params: { 1: 1 } } });
    expect(unwrap([1, 2, 3])).toEqual({ schema: 0, data: [1, 2, 3] });
  });

  it('refuses a payload from a newer build instead of half-reading it', () => {
    expect(unwrap({ schema: SCHEMA_VERSION + 1, data: {} })).toBeNull();
    expect(unwrap({ schema: SCHEMA_VERSION, data: { ok: true } })).not.toBeNull();
  });

  it('reads nothing from nothing', () => {
    expect(unwrap(null)).toBeNull();
    expect(unwrap(undefined)).toBeNull();
  });
});

describe('merge over defaults', () => {
  const defaults = { a: 1, b: 'two', list: [1, 2], nested: { x: 1 } };

  it('keeps known values, adds what was missing and drops what it does not know', () => {
    const merged = mergeKnown(defaults, { a: 9, unknown: 'dropped' });
    expect(merged).toEqual({ a: 9, b: 'two', list: [1, 2], nested: { x: 1 } });
    expect('unknown' in merged).toBe(false);
  });

  it('refuses a value whose type changed', () => {
    // A string where a list belongs is a damaged document, not a new field.
    expect(mergeKnown(defaults, { list: 'nope' }).list).toEqual([1, 2]);
    expect(mergeKnown(defaults, { nested: 5 }).nested).toEqual({ x: 1 });
  });

  it('returns the defaults for junk', () => {
    expect(mergeKnown(defaults, null)).toEqual(defaults);
    expect(mergeKnown(defaults, 'x')).toEqual(defaults);
    expect(mergeKnown(defaults, [])).toEqual(defaults);
  });
});
