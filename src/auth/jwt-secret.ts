// HS256 keys shorter than 32 bytes are brute-forceable offline once a token
// leaks. The check is shared by AuthService and AuthGuard so both access and
// refresh secrets fail the same way, at the first use, with an actionable
// message instead of a silent weak-key deployment.
export const MIN_JWT_SECRET_LENGTH = 32;

export function resolveJwtSecret(envVar: string): string {
  const secret = process.env[envVar];

  if (!secret) {
    throw new Error(`${envVar} environment variable is not set`);
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `${envVar} must be at least ${MIN_JWT_SECRET_LENGTH} characters (got ${secret.length}). Generate a strong random secret and rotate the affected tokens before starting the service.`,
    );
  }

  return secret;
}
