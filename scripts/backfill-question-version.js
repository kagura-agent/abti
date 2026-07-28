#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RELIABILITY_DIR = path.resolve(__dirname, '..', 'data', 'reliability');
const VERSION = '5.22';

const files = fs.readdirSync(RELIABILITY_DIR)
  .filter(f => /run-30[1-9]\.json$/.test(f));

let updated = 0;

for (const filename of files) {
  const filePath = path.join(RELIABILITY_DIR, filename);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data.questionVersion) {
    data.questionVersion = VERSION;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    updated++;
  }
}

console.log(`Backfilled questionVersion: ${updated}/${files.length} files updated`);
