import { defineConfig } from 'orval';

const docsHostname = process.env.DOCS_HOSTNAME;
if (!docsHostname) {
  throw new Error(
    'Environment variable DOCS_HOSTNAME is required for codegen (set it in .env — see .env.example).',
  );
}

export default defineConfig({
  'backend-schemas': {
    input: `https://${docsHostname}/openAPI.yaml`,
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

