import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordSubscriptionUpdate } from "./service.js";
import { createMemoryStore } from "./store.js";

const SHOP = "test-shop.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/1001";

const webhookPayload = (overrides = {}) => ({
  app_subscription: {
    admin_graphql_api_id: SUBSCRIPTION_ID,
    name: "Basic",
    status: "ACTIVE",
    admin_graphql_api_shop_id: "gid://shopify/Shop/1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    currency: "USD",
    price: "10.25",
    ...overrides,
  },
});

describe("recordSubscriptionUpdate (webhook persistence)", () => {
  it("persists a new subscription event", async () => {
    const store = createMemoryStore();
    const result = await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload(),
      store,
    });

    assert.equal(result.applied, true);
    const records = await store.all();
    assert.equal(records.length, 1);
    assert.equal(records[0].subscriptionId, SUBSCRIPTION_ID);
    assert.equal(records[0].plan, "basic");
    assert.equal(records[0].status, "ACTIVE");
    assert.equal(records[0].price.amount, 10.25);
    assert.equal(records[0].price.currencyCode, "USD");
  });

  it("ignores duplicate deliveries without creating a second record", async () => {
    const store = createMemoryStore();
    const payload = webhookPayload();

    await recordSubscriptionUpdate({ shop: SHOP, body: payload, store });
    const duplicate = await recordSubscriptionUpdate({
      shop: SHOP,
      body: payload,
      store,
    });

    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.reason, "duplicate_or_stale");
    assert.equal((await store.all()).length, 1);
  });

  it("discards out-of-order events with an older updated_at", async () => {
    const store = createMemoryStore();
    await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload({
        status: "CANCELLED",
        updated_at: "2026-09-10T00:00:00Z",
      }),
      store,
    });

    const stale = await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload({
        status: "ACTIVE",
        updated_at: "2026-09-05T00:00:00Z",
      }),
      store,
    });

    assert.equal(stale.applied, false);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "CANCELLED");
    assert.equal((await store.all()).length, 1);
  });

  it("applies newer events and updates the stored record", async () => {
    const store = createMemoryStore();
    await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload({ status: "PENDING" }),
      store,
    });
    const newer = await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload({
        status: "ACTIVE",
        updated_at: "2026-09-02T00:00:00Z",
      }),
      store,
    });

    assert.equal(newer.applied, true);
    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "ACTIVE");
    assert.equal((await store.all()).length, 1);
  });

  it("tracks different subscription ids independently", async () => {
    const store = createMemoryStore();
    await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload(),
      store,
    });
    await recordSubscriptionUpdate({
      shop: SHOP,
      body: webhookPayload({
        admin_graphql_api_id: "gid://shopify/AppSubscription/2002",
        name: "Pro",
        price: "25.5",
      }),
      store,
    });

    assert.equal((await store.all()).length, 2);
  });

  it("rejects malformed payloads", async () => {
    const store = createMemoryStore();
    const result = await recordSubscriptionUpdate({
      shop: SHOP,
      body: {},
      store,
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, "invalid_payload");
    assert.equal((await store.all()).length, 0);
  });
});
