import { describe, expect, it } from 'vitest';
import { assertObjectKey, isStagingKey, objectKey, screenshotKey, stagingKey, stagingThumbKey, thumbKey } from './keys';

const KEY_FORM = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

describe('the object keys (plan 5.2)', () => {
  it('build the key of a file version from the project, the file and the version number, with only [a-z0-9/-]', () => {
    expect(objectKey('prj_001', 'fil_012', 3)).toBe('prj-001/fil-012/3/file');
    expect(objectKey('PRJ_001', 'Fil_012', 1)).toBe('prj-001/fil-012/1/file');
    for (const key of [objectKey('prj_001', 'fil_012', 3), thumbKey('prj_001', 'fil_012', 3), stagingKey('upl_9f3a'), stagingThumbKey('upl_9f3a'), screenshotKey('upl_9f3a')]) {
      expect(key).toMatch(KEY_FORM);
    }
  });

  it('end a thumb key in /thumb, beside the file key of the same version', () => {
    expect(thumbKey('prj_001', 'fil_012', 3)).toBe('prj-001/fil-012/3/thumb');
    expect(stagingThumbKey('upl_9f3a')).toBe('up/upl-9f3a/thumb');
  });

  it('put every staging key under up/<intentId>, and only staging keys there', () => {
    expect(stagingKey('upl_9f3a')).toBe('up/upl-9f3a/file');
    expect(isStagingKey(stagingKey('upl_9f3a'))).toBe(true);
    expect(isStagingKey(stagingThumbKey('upl_9f3a'))).toBe(true);
    expect(isStagingKey(objectKey('prj_001', 'fil_012', 1))).toBe(false);
    expect(isStagingKey(screenshotKey('upl_9f3a'))).toBe(false);
    // A project id can never make a staging key: "up" is not a project id form, and the key adds the file part.
    expect(isStagingKey('upx/a/file')).toBe(false);
  });

  it('keep a screenshot of feedback under feedback/<intentId>', () => {
    expect(screenshotKey('upl_9f3a')).toBe('feedback/upl-9f3a/file');
  });

  it('refuse an id that holds any other character, so a key never climbs out of its folder', () => {
    for (const bad of ['', '../x', 'a/b', 'a b', 'a.b', 'ملف', 'a%2f', 'a\\b']) {
      expect(() => objectKey(bad, 'fil_001', 1)).toThrow(/not a valid id/);
      expect(() => stagingKey(bad)).toThrow(/not a valid id/);
    }
  });

  it('refuse a version number that is not a whole number from 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => objectKey('prj_001', 'fil_001', bad)).toThrow(/version/);
  });

  it('check a whole key before a store uses it', () => {
    expect(() => assertObjectKey('prj-001/fil-001/1/file')).not.toThrow();
    for (const bad of ['', '/a', 'a/', 'a//b', '../a', 'a/../b', 'A/b', 'a b', 'a?b', 'a#b', 'a.b']) expect(() => assertObjectKey(bad)).toThrow(/not a valid object key/);
  });
});
