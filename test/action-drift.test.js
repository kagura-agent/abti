const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Extract detectDrift logic for unit testing (mirrors action/index.js)
const DIMENSIONS = [
  { name: 'Autonomy', poles: ['P', 'R'] },
  { name: 'Precision', poles: ['T', 'E'] },
  { name: 'Transparency', poles: ['C', 'D'] },
  { name: 'Adaptability', poles: ['F', 'N'] },
];

function detectDrift(expected, actual) {
  const e = expected.toUpperCase();
  const a = actual.toUpperCase();
  const shifted = [];
  for (let i = 0; i < DIMENSIONS.length; i++) {
    if (e[i] !== a[i]) shifted.push(DIMENSIONS[i].name);
  }
  return { drifted: shifted.length > 0, dimensions: shifted };
}

describe('detectDrift', () => {
  it('should detect no drift when types match exactly', () => {
    const result = detectDrift('PTCF', 'PTCF');
    assert.equal(result.drifted, false);
    assert.deepEqual(result.dimensions, []);
  });

  it('should be case-insensitive', () => {
    const result = detectDrift('ptcf', 'PTCF');
    assert.equal(result.drifted, false);
    assert.deepEqual(result.dimensions, []);
  });

  it('should detect single dimension drift (Autonomy)', () => {
    const result = detectDrift('PTCF', 'RTCF');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Autonomy']);
  });

  it('should detect single dimension drift (Precision)', () => {
    const result = detectDrift('PTCF', 'PECF');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Precision']);
  });

  it('should detect single dimension drift (Transparency)', () => {
    const result = detectDrift('PTCF', 'PTDF');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Transparency']);
  });

  it('should detect single dimension drift (Adaptability)', () => {
    const result = detectDrift('PTCF', 'PTCN');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Adaptability']);
  });

  it('should detect multiple dimension drift', () => {
    const result = detectDrift('PTCF', 'REDN');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Autonomy', 'Precision', 'Transparency', 'Adaptability']);
  });

  it('should detect two dimension drift', () => {
    const result = detectDrift('PTCF', 'RECF');
    assert.equal(result.drifted, true);
    assert.deepEqual(result.dimensions, ['Autonomy', 'Precision']);
  });

  it('should handle all 16 types against themselves (no drift)', () => {
    const types = [
      'PTCF', 'PTCN', 'PTDF', 'PTDN',
      'PECF', 'PECN', 'PEDF', 'PEDN',
      'RTCF', 'RTCN', 'RTDF', 'RTDN',
      'RECF', 'RECN', 'REDF', 'REDN',
    ];
    for (const t of types) {
      const result = detectDrift(t, t);
      assert.equal(result.drifted, false, `Expected no drift for ${t}`);
    }
  });

  it('should correctly identify opposite types as full drift', () => {
    // PTCF opposite is REDN (all 4 dimensions flipped)
    const result = detectDrift('PTCF', 'REDN');
    assert.equal(result.drifted, true);
    assert.equal(result.dimensions.length, 4);
  });
});
