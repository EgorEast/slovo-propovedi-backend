import { defineConfig } from 'orval';

export default defineConfig({
  'backend-schemas': {
    input: 'https://docs.slovo-propovedi.ru/openAPI.yaml',
    output: {
      mode: 'single',
      target: 'src/generated/index.ts',
      client: 'zod',
      override: {
        zod: {
          variant: 'full',
          version: 4,
          // orval 8.23.0 requires per-context boolean keys (a plain
          // `strict: true` silently normalizes to all-false).
          strict: {
            param: true,
            query: true,
            header: true,
            body: true,
            response: true,
          },
        },
      },
    },
  },
});

