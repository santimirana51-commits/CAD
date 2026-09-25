import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearestRatio, ptsBounds, rectPts } from './site.js';
import { fileURLToPath } from 'node:url';

describe('site geometry', () => {
  it('nearestRatio picks 1:1 for square', () => {
    assert.equal(nearestRatio(100, 100), '1:1');
    assert.equal(nearestRatio(160, 90), '16:9');
  });
  it('ptsBounds computes bbox', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }];
    const b = ptsBounds(pts);
    assert.equal(b.minx, 0);
    assert.equal(b.maxx, 10);
  });
  it('rectPts returns 4 corners', () => {
    const b = { minx: 0, miny: 0, maxx: 10, maxy: 5 };
    assert.equal(rectPts(b).length, 4);
  });
});
