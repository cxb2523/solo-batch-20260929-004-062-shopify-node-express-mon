import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BILLING_ERRORS, cancelSubscription } from "./service.js";
import { createMemoryStore } from "./store.js";

const SHOP = "test-shop.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/1001";

const cancelClient = (payload, calls = []) => ({
  request: async (query, options) => {
    calls.push({ query, options });
    return { data: { appSubscriptionCancel: payload } };
  },
});

const activeRecord = (overrides = {}) => ({
  subscriptionId: SUBSCRIPTION_ID,
  plan: "basic",
  planName: "Basic",
  status: "ACTIVE",
  trialDays: 0,
  sourceCreatedAt: new Date("2026-08-01T00:00:00Z"),
  sourceUpdatedAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("cancelSubscription (edge cases)", () => {
  it("returns NO_ACTIVE_SUBSCRIPTION when the shop has no subscription", async () => {
    const store = createMemoryStore();
    const calls = [];
    const result = await cancelSubscription({
      client: cancelClient(null, calls),
      shop: SHOP,
      store,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, BILLING_ERRORS.NO_ACTIVE_SUBSCRIPTION);
    assert.equal(calls.length, 0, "GraphQL must not be called");
  });

  it("returns SUBSCRIPTION_PENDING when a pending subscription exists", async () => {
    const store = createMemoryStore();
    await store.upsert(SHOP, activeRecord({ status: "PENDING" }));
    const calls = [];
    const result = await cancelSubscription({
      client: cancelClient(null, calls),
      shop: SHOP,
      store,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, BILLING_ERRORS.SUBSCRIPTION_PENDING);
    assert.equal(calls.length, 0, "GraphQL must not be called");
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "PENDING");
  });

  it("cancels a subscription inside its trial period", async () => {
    const store = createMemoryStore();
    await store.upsert(
      SHOP,
      activeRecord({ trialDays: 7, sourceCreatedAt: new Date() })
    );
    const result = await cancelSubscription({
      client: cancelClient({
        userErrors: [],
        appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
      }),
      shop: SHOP,
      store,
    });

    assert.equal(result.ok, true);
    assert.equal(result.inTrial, true);
    assert.match(result.message, /trial/i);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "CANCELLED");
    assert.ok(record.cancelledAt);
  });

  it("cancels a regular active subscription", async () => {
    const store = createMemoryStore();
    await store.upsert(SHOP, activeRecord());
    const result = await cancelSubscription({
      client: cancelClient({
        userErrors: [],
        appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
      }),
      shop: SHOP,
      store,
    });

    assert.equal(result.ok, true);
    assert.equal(result.inTrial, false);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "CANCELLED");
  });

  it("rolls back local state and returns a readable code on GraphQL userErrors", async () => {
    const store = createMemoryStore();
    await store.upsert(SHOP, activeRecord());
    const result = await cancelSubscription({
      client: cancelClient({
        userErrors: [{ field: ["id"], message: "Subscription not found" }],
        appSubscription: null,
      }),
      shop: SHOP,
      store,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, BILLING_ERRORS.GRAPHQL_ERROR);
    assert.match(result.message, /Subscription not found/);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "ACTIVE", "local state must be rolled back");
    assert.equal(record.cancelledAt ?? null, null);
  });
});
