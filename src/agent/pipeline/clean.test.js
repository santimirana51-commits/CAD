import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN_SIZE } from '../../shared/config/tunables.js';

// pure unit test — no DOM, no canvas
describe('clean pipeline tunables', () => {
  it('CLEAN_SIZE is 2048 (door swings survive)', () => {
    assert.equal(CLEAN_SIZE, 2048);
  });
  it('Otsu threshold is pure function', async () => {
    const { otsuThreshold } = await import('./clean.js');
    const hist = new Uint32Array(256);
    hist[0] = 100; hist[255] = 100;
    const t = otsuThreshold(hist, 200);
    assert.ok(t >= 0 && t < 255, 'threshold in range');
  });
});
