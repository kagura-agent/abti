const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '..', 'cli', 'bin', 'abti.js');
const PRELOAD = path.resolve(__dirname, 'list-preload.js');

function runList(extraArgs = []) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--require', PRELOAD, CLI, 'list', ...extraArgs], {
      timeout: 10000,
      env: { ...process.env, NO_COLOR: '1' },
    }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

describe('abti list subcommand', () => {
  it('shows all agents in table format by default', async () => {
    const { code, stdout } = await runList();
    assert.equal(code, 0);
    assert.ok(stdout.includes('Alpha Bot'));
    assert.ok(stdout.includes('Beta Bot'));
    assert.ok(stdout.includes('Gamma Bot'));
    assert.ok(stdout.includes('Delta Bot'));
    assert.ok(stdout.includes('Epsilon Bot'));
    assert.ok(stdout.includes('5 agent(s)'));
  });

  it('filters by --type', async () => {
    const { code, stdout } = await runList(['--type', 'PTCF']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Alpha Bot'));
    assert.ok(stdout.includes('Gamma Bot'));
    assert.ok(!stdout.includes('Beta Bot'));
    assert.ok(!stdout.includes('Delta Bot'));
    assert.ok(stdout.includes('2 agent(s)'));
  });

  it('--type is case insensitive', async () => {
    const { code, stdout } = await runList(['--type', 'ptcf']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Alpha Bot'));
    assert.ok(stdout.includes('Gamma Bot'));
  });

  it('filters by --provider', async () => {
    const { code, stdout } = await runList(['--provider', 'anthropic']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Beta Bot'));
    assert.ok(stdout.includes('Epsilon Bot'));
    assert.ok(!stdout.includes('Alpha Bot'));
    assert.ok(!stdout.includes('Delta Bot'));
  });

  it('--provider is case insensitive', async () => {
    const { code, stdout } = await runList(['--provider', 'OpenAI']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Alpha Bot'));
    assert.ok(stdout.includes('Gamma Bot'));
  });

  it('combines --type and --provider filters', async () => {
    const { code, stdout } = await runList(['--type', 'PTCF', '--provider', 'openai']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('Alpha Bot'));
    assert.ok(stdout.includes('Gamma Bot'));
    assert.ok(!stdout.includes('Beta Bot'));
  });

  it('outputs JSON with --json flag', async () => {
    const { code, stdout } = await runList(['--json']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    assert.ok(Array.isArray(agents));
    assert.equal(agents.length, 5);
    assert.equal(agents[0].name, 'Alpha Bot');
  });

  it('--json respects filters', async () => {
    const { code, stdout } = await runList(['--json', '--type', 'REDN']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    assert.equal(agents.length, 2);
    assert.ok(agents.every(a => a.type === 'REDN'));
  });

  it('errors on invalid --sort value', async () => {
    const { code, stderr } = await runList(['--sort', 'invalid']);
    assert.notEqual(code, 0);
    assert.ok(stderr.includes('Invalid --sort value'));
    assert.ok(stderr.includes('invalid'));
  });

  it('shows "No agents found" when filters match nothing', async () => {
    const { code, stdout } = await runList(['--type', 'XXXX']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('No agents found'));
  });

  it('sorts by name by default', async () => {
    const { code, stdout } = await runList(['--json']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    const names = agents.map(a => a.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted);
  });

  it('sorts by reliability descending', async () => {
    const { code, stdout } = await runList(['--json', '--sort', 'reliability']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    // Gamma (1.0), Alpha (0.95), Beta (0.80), Delta (0.60), Epsilon (null→0)
    assert.equal(agents[0].name, 'Gamma Bot');
    assert.equal(agents[1].name, 'Alpha Bot');
    assert.equal(agents[2].name, 'Beta Bot');
    assert.equal(agents[3].name, 'Delta Bot');
    assert.equal(agents[4].name, 'Epsilon Bot');
  });

  it('sorts by type', async () => {
    const { code, stdout } = await runList(['--json', '--sort', 'type']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    const types = agents.map(a => a.type);
    const sorted = [...types].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(types, sorted);
  });

  it('sorts by provider', async () => {
    const { code, stdout } = await runList(['--json', '--sort', 'provider']);
    assert.equal(code, 0);
    const agents = JSON.parse(stdout);
    const providers = agents.map(a => a.provider);
    const sorted = [...providers].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(providers, sorted);
  });

  it('table output includes headers', async () => {
    const { code, stdout } = await runList();
    assert.equal(code, 0);
    assert.ok(stdout.includes('Name'));
    assert.ok(stdout.includes('Provider'));
    assert.ok(stdout.includes('Type'));
    assert.ok(stdout.includes('Reliability'));
  });

  it('table shows reliability as percentage', async () => {
    const { code, stdout } = await runList();
    assert.equal(code, 0);
    assert.ok(stdout.includes('95%'));
    assert.ok(stdout.includes('100%'));
  });
});
