/**
 * Runtime env access for @gmacko/ooda-web.
 *
 * Minimal by design -- extends as more vars are needed.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing ${name}. Set it in .env. ` +
        `Value is required for the @gmacko/ooda-web runtime.`,
    );
  }
  return value;
}

export const env = {
  get DATABASE_URL(): string {
    return required("DATABASE_URL");
  },
};
