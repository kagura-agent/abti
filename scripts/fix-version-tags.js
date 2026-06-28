#!/usr/bin/env node
/**
 * fix-version-tags.js
 * Sets questionVersion to '5.4-beta' in all top-level JSON files under data/reliability/
 */

const fs = require('fs');
const path = require('path');

const TARGET_VERSION = '5.4-beta';
const dir = path.join(__dirname, '..', 'data', 'reliability');

const entries = fs.readdirSync(dir, { withFileTypes: true });
let updated = 0;
let skipped = 0;

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

  const filePath = path.join(dir, entry.name);
  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn(`  SKIP (parse error): ${entry.name}`);
    skipped++;
    continue;
  }

  if (data.questionVersion === TARGET_VERSION) {
    skipped++;
    continue;
  }

  data.questionVersion = TARGET_VERSION;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n');
  updated++;
}

console.log(`Done. Updated: ${updated}, Already correct/skipped: ${skipped}`);
