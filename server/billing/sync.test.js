import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { syncFromShopify } from "./service.js";
import { createMemoryStore } from "./store.js";

const SHOP = "test-shop.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/1001";

const liveClient = (activeSubscriptions) => ({
  request: async () => ({
    data: { currentAppInstallation: { activeSubscriptions } },
  }),
});

const liveSubscription = (overrides = {}) => ({
  id: SUBSCRIPTION_ID,
  name: "Basic",
  status: "ACTIVE",
  test: true,
  trialDays: 7,
  createdAt: "2026-09-01T00:00:00Z",
  lineItems: [
    {
      plan: {
        pricingDetails: {
          __typename: "AppRecurringPricing",
          interval: "EVERY_30_DAYS",
          price: { amount: "10.25", currencyCode: "USD" },
        },
      },
    },
  ],
  ...overrides,
});

describe("syncFromShopify (state correction)", () => {
  it("persists a live active subscription into the store", async () => {
    const store = createMemoryStore();
    const state = await syncFromShopify({
      client: liveClient([liveSubscription()]),
      shop: SHOP,
      store,
    });

    assert.equal(state.subscription.subscriptionId, SUBSCRIPTION_ID);
    assert.equal(state.subscription.status, "ACTIVE");
    assert.equal(state.subscription.plan, "basic");
    assert.equal(state.subscription.price.amount, 10.25);
    assert.equal(state.inTrial, false);
    assert.ok(state.plans.length >= 2);
  });

  it("flags subscriptions still inside their trial period", async () => {
    const store = createMemoryStore();
    const state = await syncFromShopify({
      client: liveClient([
        liveSubscription({ createdAt: new Date().toISOString() }),
      ]),
      shop: SHOP,
      store,
    });

    assert.equal(state.inTrial, true);
  });

  it("marks a local ACTIVE record as CANCELLED when Shopify no longer returns it", async () => {
    const store = createMemoryStore();
    await store.upsert(SHOP, {
      subscriptionId: SUBSCRIPTION_ID,
      plan: "basic",
      planName: "Basic",
      status: "ACTIVE",
      sourceUpdatedAt: new Date("2026-09-01T00:00:00Z"),
    });

    const state = await syncFromShopify({
      client: liveClient([]),
      shop: SHOP,
      store,
    });

    assert.equal(state.subscription, null);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "CANCELLED");
    assert.ok(record.cancelledAt);
  });

  it("preserves sourceUpdatedAt so the webhook ordering guard still works", async () => {
    const store = createMemoryStore();
    const webhookTimestamp = new Date("2026-09-20T00:00:00Z");
    await store.upsert(SHOP, {
      subscriptionId: SUBSCRIPTION_ID,
      plan: "basic",
      planName: "Basic",
      status: "ACTIVE",
      sourceUpdatedAt: webhookTimestamp,
    });

    await syncFromShopify({
      client: liveClient([liveSubscription()]),
      shop: SHOP,
      store,
    });

    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(
      new Date(record.sourceUpdatedAt).getTime(),
      webhookTimestamp.getTime()
    );
  });

  it("returns no subscription when Shopify and the store are both empty", async () => {
    const store = createMemoryStore();
    const state = await syncFromShopify({
      client: liveClient([]),
      shop: SHOP,
      store,
    });

    assert.equal(state.subscription, null);
    assert.equal((await store.all()).length, 0);
  });
});
