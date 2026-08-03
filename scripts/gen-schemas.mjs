#!/usr/bin/env node

/**
 * Custom script to run orval with a specific config
 * This works around Node.js 22 compatibility issues with the orval CLI
 */

import orval from 'orval';

orval('./orval.config.mjs')
  .then(() => {
    console.log('✅ Schemas generated successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Schema generation failed:', error);
    process.exit(1);
  });