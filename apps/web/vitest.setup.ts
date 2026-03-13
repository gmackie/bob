Object.assign(process.env, {
  NODE_ENV: "development",
});
process.env.AUTH_GITHUB_ID ??= "github-test-id";
process.env.AUTH_GITHUB_SECRET ??= "github-test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/test";
