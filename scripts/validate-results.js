#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validateResults(data) {
  const errors = [];

  if (!data || !Array.isArray(data.agents)) {
    return ['Top-level "agents" must be an array'];
  }

  const slugs = new Set();

  for (let i = 0; i < data.agents.length; i++) {
    const a = data.agents[i];
    const prefix = `agents[${i}] (${a.slug || a.name || '?'})`;

    if (typeof a.name !== 'string' || !a.name) {
      errors.push(`${prefix}: name must be a non-empty string`);
    }
    if (typeof a.slug !== 'string' || !a.slug) {
      errors.push(`${prefix}: slug must be a non-empty string`);
    } else {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)) {
        errors.push(`${prefix}: slug must be kebab-case`);
      }
      if (slugs.has(a.slug)) {
        errors.push(`${prefix}: duplicate slug "${a.slug}"`);
      }
      slugs.add(a.slug);
    }
    if (typeof a.nick !== 'string' || !a.nick) {
      errors.push(`${prefix}: nick must be a non-empty string`);
    }
    if (typeof a.type !== 'string' || a.type.length !== 4) {
      errors.push(`${prefix}: type must be a 4-character string`);
    }

    if (!Array.isArray(a.scores) || a.scores.length !== 4) {
      errors.push(`${prefix}: scores must be an array of 4 integers`);
    } else {
      for (let j = 0; j < 4; j++) {
        if (!Number.isInteger(a.scores[j]) || a.scores[j] < 0 || a.scores[j] > 4) {
          errors.push(`${prefix}: scores[${j}] must be an integer 0-4, got ${a.scores[j]}`);
        }
      }
    }

    if (!Array.isArray(a.dimensions) || a.dimensions.length !== 4) {
      errors.push(`${prefix}: dimensions must be an array of 4 objects`);
    } else {
      for (let j = 0; j < 4; j++) {
        const dim = a.dimensions[j];
        if (!Array.isArray(dim.poles) || dim.poles.length !== 2 ||
            typeof dim.poles[0] !== 'string' || dim.poles[0].length !== 1 ||
            typeof dim.poles[1] !== 'string' || dim.poles[1].length !== 1) {
          errors.push(`${prefix}: dimensions[${j}].poles must be [char, char]`);
        }
        if (dim.max !== 4) {
          errors.push(`${prefix}: dimensions[${j}].max must be 4, got ${dim.max}`);
        }
        if (Array.isArray(a.scores) && a.scores.length === 4 && dim.score !== a.scores[j]) {
          errors.push(`${prefix}: dimensions[${j}].score (${dim.score}) must equal scores[${j}] (${a.scores[j]})`);
        }
      }

      if (Array.isArray(a.scores) && a.scores.length === 4 && typeof a.type === 'string' && a.type.length === 4) {
        const derived = a.dimensions.map((dim, j) =>
          a.scores[j] >= 2 ? dim.poles[0] : dim.poles[1]
        ).join('');
        if (a.type !== derived) {
          errors.push(`${prefix}: type "${a.type}" does not match derived "${derived}" from scores`);
        }
      }
    }
  }

  return errors;
}

if (require.main === module) {
  const filePath = process.argv[2] || path.join(__dirname, '..', 'data', 'results.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read/parse ${filePath}: ${e.message}`);
    process.exit(1);
  }

  const errors = validateResults(data);
  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`Valid: ${data.agents.length} agents, all checks passed.`);
}

module.exports = { validateResults };
