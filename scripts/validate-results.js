#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_POLES = [['P', 'R'], ['T', 'E'], ['C', 'D'], ['F', 'N']];
const SLUG_RE = /^[a-z0-9-]+$/;

function validate(data) {
  const errors = [];
  const warnings = [];

  if (!data || !Array.isArray(data.agents)) {
    return { errors: ['Top-level must be { agents: [...] }'], warnings: [] };
  }

  const slugs = new Set();

  for (let i = 0; i < data.agents.length; i++) {
    const a = data.agents[i];
    const prefix = `agents[${i}] (${a.slug || a.name || '?'})`;

    if (typeof a.name !== 'string' || !a.name) {
      errors.push(`${prefix}: name must be non-empty string`);
    }

    if (typeof a.slug !== 'string' || !SLUG_RE.test(a.slug)) {
      errors.push(`${prefix}: slug must match /^[a-z0-9-]+$/`);
    } else if (slugs.has(a.slug)) {
      errors.push(`${prefix}: duplicate slug "${a.slug}"`);
    } else {
      slugs.add(a.slug);
    }

    if (typeof a.type !== 'string' || a.type.length !== 4) {
      errors.push(`${prefix}: type must be 4-char string`);
    }

    if (typeof a.nick !== 'string' || !a.nick) {
      errors.push(`${prefix}: nick must be non-empty string`);
    }

    if (!Array.isArray(a.scores) || a.scores.length !== 4 ||
        a.scores.some(s => !Number.isInteger(s) || s < 0 || s > 4)) {
      errors.push(`${prefix}: scores must be array of 4 integers (0-4)`);
    }

    if (typeof a.testedAt !== 'string' || isNaN(Date.parse(a.testedAt))) {
      errors.push(`${prefix}: testedAt must be valid ISO-8601 date`);
    }

    if (!Array.isArray(a.dimensions) || a.dimensions.length !== 4) {
      errors.push(`${prefix}: dimensions must be array of exactly 4 objects`);
    } else {
      for (let d = 0; d < 4; d++) {
        const dim = a.dimensions[d];
        const dp = `${prefix} dim[${d}]`;

        if (!Array.isArray(dim.poles) || dim.poles.length !== 2) {
          errors.push(`${dp}: poles must be array of 2 strings`);
          continue;
        }

        if (dim.poles[0] !== EXPECTED_POLES[d][0] || dim.poles[1] !== EXPECTED_POLES[d][1]) {
          errors.push(`${dp}: poles must be [${EXPECTED_POLES[d]}], got [${dim.poles}]`);
        }

        if (!Number.isInteger(dim.score) || dim.score < 0 || dim.score > 4) {
          errors.push(`${dp}: score must be integer 0-4`);
        }

        if (!Number.isInteger(dim.max) || dim.max < 1) {
          errors.push(`${dp}: max must be positive integer`);
        }

      }

      if (typeof a.type === 'string' && a.type.length === 4 &&
          Array.isArray(a.scores) && a.scores.length === 4 &&
          a.dimensions.every(dim => Number.isInteger(dim.max))) {
        const derived = a.dimensions.map((dim, d) =>
          a.scores[d] >= dim.max / 2 ? dim.poles[0] : dim.poles[1]
        ).join('');
        if (derived !== a.type) {
          warnings.push(`${prefix}: type "${a.type}" doesn't match derived "${derived}"`);
        }
      }
    }
  }

  return { errors, warnings };
}

if (require.main === module) {
  const filePath = process.argv[2] || path.join(__dirname, '..', 'data', 'results.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const { errors, warnings } = validate(data);

  if (warnings.length) {
    console.warn(`${warnings.length} warning(s):`);
    warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  if (errors.length) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`OK: ${data.agents.length} agents validated`);
  process.exit(0);
}

module.exports = { validate };
