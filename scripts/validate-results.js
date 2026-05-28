#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function validateResults(data) {
  const errors = [];

  if (!data || !Array.isArray(data.agents)) {
    errors.push('Top-level "agents" must be an array');
    return errors;
  }

  const slugs = new Set();
  const expectedPoles = [['P', 'R'], ['T', 'E'], ['C', 'D'], ['F', 'N']];

  for (let i = 0; i < data.agents.length; i++) {
    const a = data.agents[i];
    const label = `Agent #${i} (${a.name || a.slug || 'unknown'})`;

    if (typeof a.name !== 'string' || !a.name) {
      errors.push(`${label}: "name" must be a non-empty string`);
    }
    if (typeof a.slug !== 'string' || !a.slug) {
      errors.push(`${label}: "slug" must be a non-empty string`);
    } else if (!/^[a-z0-9-]+$/.test(a.slug)) {
      errors.push(`${label}: "slug" must be lowercase alphanumeric + hyphens, got "${a.slug}"`);
    } else if (slugs.has(a.slug)) {
      errors.push(`${label}: duplicate slug "${a.slug}"`);
    } else {
      slugs.add(a.slug);
    }

    if (typeof a.type !== 'string' || a.type.length !== 4) {
      errors.push(`${label}: "type" must be a 4-character string`);
    }
    if (typeof a.nick !== 'string' || !a.nick) {
      errors.push(`${label}: "nick" must be a non-empty string`);
    }
    if (typeof a.model !== 'string' || !a.model) {
      errors.push(`${label}: "model" must be a non-empty string`);
    }
    if (typeof a.provider !== 'string' || !a.provider) {
      errors.push(`${label}: "provider" must be a non-empty string`);
    }

    if (!Array.isArray(a.scores) || a.scores.length !== 4) {
      errors.push(`${label}: "scores" must be an array of exactly 4 integers`);
    } else {
      for (let j = 0; j < 4; j++) {
        if (!Number.isInteger(a.scores[j]) || a.scores[j] < 0 || a.scores[j] > 4) {
          errors.push(`${label}: scores[${j}] must be an integer 0-4, got ${a.scores[j]}`);
        }
      }
    }

    if (!Array.isArray(a.dimensions) || a.dimensions.length !== 4) {
      errors.push(`${label}: "dimensions" must be an array of exactly 4 objects`);
    } else {
      for (let j = 0; j < 4; j++) {
        const d = a.dimensions[j];
        if (!d || typeof d !== 'object') {
          errors.push(`${label}: dimensions[${j}] must be an object`);
          continue;
        }
        if (!Array.isArray(d.poles) || d.poles.length !== 2 ||
            typeof d.poles[0] !== 'string' || d.poles[0].length !== 1 ||
            typeof d.poles[1] !== 'string' || d.poles[1].length !== 1) {
          errors.push(`${label}: dimensions[${j}].poles must be [char, char]`);
        } else if (d.poles[0] !== expectedPoles[j][0] || d.poles[1] !== expectedPoles[j][1]) {
          errors.push(`${label}: dimensions[${j}].poles must be [${expectedPoles[j]}], got [${d.poles}]`);
        }
        if (!Number.isInteger(d.score) || d.score < 0 || d.score > 4) {
          errors.push(`${label}: dimensions[${j}].score must be integer 0-4`);
        }
        if (d.max !== 4) {
          errors.push(`${label}: dimensions[${j}].max must be 4`);
        }
      }
    }

    if (typeof a.type === 'string' && a.type.length === 4 &&
        Array.isArray(a.dimensions) && a.dimensions.length === 4 &&
        a.dimensions.every(d => d && Array.isArray(d.poles) && d.poles.length === 2 && Number.isInteger(d.score))) {
      const derived = a.dimensions.map(d => d.score > d.max / 2 ? d.poles[0] : d.poles[1]).join('');
      if (derived !== a.type) {
        errors.push(`${label}: type "${a.type}" doesn't match derived type "${derived}" from dimensions/scores`);
      }
    }

    if (Array.isArray(a.scores) && a.scores.length === 4 &&
        Array.isArray(a.dimensions) && a.dimensions.length === 4) {
      for (let j = 0; j < 4; j++) {
        if (a.dimensions[j] && a.scores[j] !== a.dimensions[j].score) {
          errors.push(`${label}: scores[${j}] (${a.scores[j]}) != dimensions[${j}].score (${a.dimensions[j].score})`);
        }
      }
    }
  }

  return errors;
}

if (require.main === module) {
  const filePath = path.join(__dirname, '..', 'data', 'results.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${filePath}: ${e.message}`);
    process.exit(1);
  }

  const errors = validateResults(data);

  if (errors.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    console.error(`\n${data.agents.length} agents checked, ${errors.length} error(s) found.`);
    process.exit(1);
  }

  console.log(`${data.agents.length} agents validated, 0 errors.`);
  process.exit(0);
}

module.exports = { validateResults };
