#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_POLES = [['P', 'R'], ['T', 'E'], ['C', 'D'], ['F', 'N']];

function validate(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const errors = [];

  if (!data.agents || !Array.isArray(data.agents)) {
    errors.push('Top-level "agents" must be an array');
    return errors;
  }

  const slugs = new Set();

  for (let idx = 0; idx < data.agents.length; idx++) {
    const a = data.agents[idx];
    const prefix = `agents[${idx}] (${a.name || 'unnamed'})`;

    if (typeof a.name !== 'string' || !a.name) errors.push(`${prefix}: name must be a non-empty string`);
    if (typeof a.slug !== 'string' || !/^[a-z0-9-]+$/.test(a.slug)) errors.push(`${prefix}: slug must match /^[a-z0-9-]+$/`);
    if (typeof a.nick !== 'string' || !a.nick) errors.push(`${prefix}: nick must be a non-empty string`);
    if (typeof a.model !== 'string' || !a.model) errors.push(`${prefix}: model must be a non-empty string`);
    if (typeof a.provider !== 'string' || !a.provider) errors.push(`${prefix}: provider must be a non-empty string`);
    if (typeof a.testedAt !== 'string' || isNaN(Date.parse(a.testedAt))) errors.push(`${prefix}: testedAt must be a valid ISO date`);

    if (typeof a.type !== 'string' || a.type.length !== 4) {
      errors.push(`${prefix}: type must be a 4-char string`);
    }

    if (!Array.isArray(a.scores) || a.scores.length !== 4 || !a.scores.every(s => Number.isInteger(s) && s >= 0 && s <= 4)) {
      errors.push(`${prefix}: scores must be an array of exactly 4 integers (0-4)`);
    }

    if (!Array.isArray(a.dimensions) || a.dimensions.length !== 4) {
      errors.push(`${prefix}: dimensions must be an array of exactly 4 objects`);
    } else {
      for (let d = 0; d < 4; d++) {
        const dim = a.dimensions[d];
        const dp = `${prefix}.dimensions[${d}]`;
        if (!Array.isArray(dim.poles) || dim.poles.length !== 2 || dim.poles[0] !== EXPECTED_POLES[d][0] || dim.poles[1] !== EXPECTED_POLES[d][1]) {
          errors.push(`${dp}: poles must be ${JSON.stringify(EXPECTED_POLES[d])}`);
        }
        if (!Number.isInteger(dim.score) || dim.score < 0 || dim.score > 4) errors.push(`${dp}: score must be int 0-4`);
        if (dim.max !== 4) errors.push(`${dp}: max must be 4`);
      }

      if (Array.isArray(a.scores) && a.scores.length === 4) {
        for (let d = 0; d < 4; d++) {
          if (a.dimensions[d] && a.scores[d] !== a.dimensions[d].score) {
            errors.push(`${prefix}: scores[${d}] (${a.scores[d]}) !== dimensions[${d}].score (${a.dimensions[d].score})`);
          }
        }
      }
    }

    if (typeof a.type === 'string' && a.type.length === 4 && Array.isArray(a.scores) && a.scores.length === 4) {
      const derived = a.scores.map((s, i) => s >= 2 ? EXPECTED_POLES[i][0] : EXPECTED_POLES[i][1]).join('');
      if (a.type !== derived) errors.push(`${prefix}: type "${a.type}" doesn't match derived "${derived}" from scores`);
    }

    if (a.deprecated !== undefined && typeof a.deprecated !== 'boolean') errors.push(`${prefix}: deprecated must be a boolean`);
    if (a.deprecatedReason !== undefined && typeof a.deprecatedReason !== 'string') errors.push(`${prefix}: deprecatedReason must be a string`);

    // reliabilityRuns: must be array of {type,scores} objects or integer 0
    if (a.reliabilityRuns !== undefined && a.reliabilityRuns !== null) {
      if (Array.isArray(a.reliabilityRuns)) {
        for (let r = 0; r < a.reliabilityRuns.length; r++) {
          const run = a.reliabilityRuns[r];
          const rp = `${prefix}.reliabilityRuns[${r}]`;
          if (typeof run.type !== 'string' || run.type.length !== 4) errors.push(`${rp}: type must be a 4-char string`);
          if (!Array.isArray(run.scores) || run.scores.length !== 4 || !run.scores.every(s => Number.isInteger(s) && s >= 0 && s <= 4)) {
            errors.push(`${rp}: scores must be an array of exactly 4 integers (0-4)`);
          }
        }
      } else if (a.reliabilityRuns !== 0) {
        errors.push(`${prefix}: reliabilityRuns must be an array of run objects or 0, got ${typeof a.reliabilityRuns} (${a.reliabilityRuns})`);
      }
    }

    if (slugs.has(a.slug)) errors.push(`${prefix}: duplicate slug "${a.slug}"`);
    slugs.add(a.slug);
  }

  return errors;
}

if (require.main === module) {
  const filePath = path.resolve(__dirname, '..', 'data', 'results.json');
  const errors = validate(filePath);
  if (errors.length) {
    console.error(`❌ ${errors.length} validation error(s):`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`✅ results.json valid (${JSON.parse(fs.readFileSync(filePath, 'utf8')).agents.length} agents)`);
}

module.exports = { validate };
