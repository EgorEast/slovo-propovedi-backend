import { defineConfig } from 'orval';

export default defineConfig({
  'backend-schemas': {
    input: '../openAPI.yaml',
    output: {
      mode: 'single',
      target: 'src/generated/index.ts',
      client: 'zod',
      override: {
        zod: {
          variant: 'full',
          version: 4,
        },
      },
    },
  },
});