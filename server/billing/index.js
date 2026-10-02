/**
 * Test discovery shim.
 *
 * `node --test server/billing/` resolves the directory to this file, so the
 * shim dynamically imports every *.test.js sibling. The Express router lives
 * in routes.js and is imported directly by server/index.js, keeping Express
 * and Mongoose out of the test module graph.
 */
if (!process.env.NODE_TEST_CONTEXT) {
  throw new Error(
    "server/billing/index.js is the node:test entry; import routes.js for the router"
  );
}

const { readdirSync } = await import("node:fs");

const testFiles = readdirSync(new URL(".", import.meta.url))
  .filter((file) => file.endsWith(".test.js"))
  .sort();

for (const file of testFiles) {
  await import(new URL(file, import.meta.url).href);
}
