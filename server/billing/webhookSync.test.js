import assert from "node:assert/strict";
import { describe, it } from "node:test";

import createMemoryStore from "./memoryStore.js";
import applySubscriptionUpdate from "./webhookSync.js";

const SHOP = "test-store.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/1007";

const buildPayload = (overrides = {}) => ({
  app_subscription: {
    admin_graphql_api_id: SUBSCRIPTION_ID,
    name: "Starter Plan",
    status: "active",
    admin_graphql_api_shop_id: "gid://shopify/Shop/1",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    currency: "USD",
    capped_amount: "0.00",
    price: "10.25",
    interval: "EVERY_30_DAYS",
    plan_handle: "starter",
    ...overrides,
  },
});

describe("applySubscriptionUpdate - persistence and idempotency", () => {
  it("writes the subscription id, plan, status and timestamps on first delivery", async () => {
    const store = createMemoryStore();

    const result = await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload(),
    });

    assert.equal(result.invalid, false);
    assert.equal(result.duplicate, false);
    assert.equal(result.stale, false);

    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.shop, SHOP);
    assert.equal(record.subscriptionId, SUBSCRIPTION_ID);
    assert.equal(record.planHandle, "starter");
    assert.equal(record.planName, "Starter Plan");
    assert.equal(record.status, "ACTIVE");
    assert.equal(record.price, 10.25);
    assert.equal(record.currencyCode, "USD");
    assert.equal(record.createdAt, "2026-10-01T10:00:00.000Z");
    assert.equal(record.updatedAt, "2026-10-01T10:00:00.000Z");

    const all = await store.listForShop(SHOP);
    assert.equal(all.length, 1);
  });

  it("treats a redelivery with the same updated_at as duplicate and never inserts a second record", async () => {
    const store = createMemoryStore();

    await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload(),
    });

    const redelivered = await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload(),
    });

    assert.equal(redelivered.duplicate, true);
    assert.equal(redelivered.stale, false);

    const all = await store.listForShop(SHOP);
    assert.equal(all.length, 1, "no second record on redelivery");
    assert.equal(all[0].status, "ACTIVE");
  });

  it("discards an out-of-order event with an older updated_at", async () => {
    const store = createMemoryStore();

    await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload({
        status: "cancelled",
        updated_at: "2026-10-02T12:00:00.000Z",
      }),
    });

    const older = await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload({
        status: "active",
        updated_at: "2026-10-02T11:00:00.000Z",
      }),
    });

    assert.equal(older.stale, true);
    assert.equal(older.duplicate, false);

    const all = await store.listForShop(SHOP);
    assert.equal(all.length, 1);
    assert.equal(
      all[0].status,
      "CANCELLED",
      "older event must not overwrite newer state"
    );
  });

  it("applies a newer event and records the status change", async () => {
    const store = createMemoryStore();

    await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload({ status: "pending" }),
    });

    const newer = await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload({
        status: "active",
        updated_at: "2026-10-01T12:00:00.000Z",
      }),
    });

    assert.equal(newer.duplicate, false);
    assert.equal(newer.stale, false);

    const record = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(record.status, "ACTIVE");
  });

  it("scopes idempotency to a shop and subscription id", async () => {
    const store = createMemoryStore();

    await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: buildPayload(),
    });

    const otherShop = await applySubscriptionUpdate({
      store,
      shop: "other-store.myshopify.com",
      payload: buildPayload(),
    });

    assert.equal(otherShop.duplicate, false);
    assert.equal((await store.listForShop(SHOP)).length, 1);
    assert.equal(
      (await store.listForShop("other-store.myshopify.com")).length,
      1
    );
  });

  it("returns invalid and writes nothing for a malformed payload", async () => {
    const store = createMemoryStore();

    const result = await applySubscriptionUpdate({
      store,
      shop: SHOP,
      payload: { app_subscription: { name: "Starter Plan" } },
    });

    assert.equal(result.invalid, true);
    assert.deepEqual(await store.listForShop(SHOP), []);
  });
});
