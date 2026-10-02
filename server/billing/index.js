/**
 * Test entry point. `node --test server/billing/` resolves this directory to
 * index.js, so importing the test files here registers the whole suite.
 */
import "./webhook.test.js";
import "./sync.test.js";
import "./cancel.test.js";
