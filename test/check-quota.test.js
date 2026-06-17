const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const e2eEnabled = process.env.GH_E2E_TEST === '1' && !!process.env.GITHUB_TOKEN;

it('exits 2 when the quota probe curl request fails', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-check-quota-bin-'));
  try {
    fs.writeFileSync(path.join(binDir, 'gh'), '#!/bin/sh\necho fake-token\n', { mode: 0o755 });
    fs.writeFileSync(path.join(binDir, 'curl'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });

    const result = spawnSync('bash', [
      'resume-reliability.sh',
      '--check-quota',
      'Meta-Llama-3.1-8B-Instruct',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    });

    assert.strictEqual(result.status, 2);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

describe('resume-reliability --check-quota', { skip: e2eEnabled ? false : 'set GH_E2E_TEST=1 and GITHUB_TOKEN to run' }, () => {
  it('exits with a documented status code', () => {
    const result = spawnSync('bash', [
      'resume-reliability.sh',
      '--check-quota',
      'Meta-Llama-3.1-8B-Instruct',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.ok(
      [0, 3, 4, 5].includes(result.status),
      `expected exit code 0, 3, 4, or 5; got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  });
});
