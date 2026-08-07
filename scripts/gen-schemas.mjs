#!/usr/bin/env node

/**
 * Custom script to run orval with a specific config
 * This works around Node.js 22 compatibility issues with the orval CLI
 */

import orval from 'orval';
import prettier from 'prettier';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUTPUT_FILE = resolve(import.meta.dirname, '..', 'src', 'generated', 'index.ts');

orval('./orval.config.mjs')
  .then(async () => {
    const raw = await readFile(OUTPUT_FILE, 'utf8');
    const config = await prettier.resolveConfig(OUTPUT_FILE);
    const formatted = await prettier.format(raw, { ...config, filepath: OUTPUT_FILE });
    await writeFile(OUTPUT_FILE, formatted, 'utf8');
    console.log('✅ Schemas generated and formatted successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Schema generation failed:', error);
    process.exit(1);
  });
