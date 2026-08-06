export default {
  root: new URL(".", import.meta.url).pathname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
};
