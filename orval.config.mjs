import { defineConfig } from 'orval';

// The spec normally comes from the published docs host. OPENAPI_SPEC_PATH
// points codegen at a local checkout of slovo-propovedi-docs instead (used
// while a spec change is not published yet) and makes DOCS_HOSTNAME optional.
const docsHostname = process.env.DOCS_HOSTNAME;
const localSpecPath = process.env.OPENAPI_SPEC_PATH;
if (!localSpecPath && !docsHostname) {
  throw new Error(
    'Environment variable DOCS_HOSTNAME is required for codegen (set it in .env — see .env.example), or set OPENAPI_SPEC_PATH to a local openAPI.yaml.',
  );
}
const specInput = localSpecPath ?? `https://${docsHostname}/openAPI.yaml`;

export default defineConfig({
  'backend-schemas': {
    input: specInput,
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

