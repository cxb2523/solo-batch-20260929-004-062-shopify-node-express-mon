import assert from "node:assert/strict";
import { describe, it } from "node:test";

import createMemoryStore from "./memoryStore.js";
import { reconcileWithShopify } from "./reconcile.js";

const SHOP = "test-store.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/2048";

const graphqlResponse = (subscriptions) => ({
  data: {
    currentAppInstallation: {
      activeSubscriptions: subscriptions,
    },
  },
});

const gqlSubscription = (overrides = {}) => ({
  id: SUBSCRIPTION_ID,
  name: "Starter Plan",
  status: "ACTIVE",
  test: true,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  trialDays: 0,
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

const seedPendingRecord = (store, overrides = {}) =>
  store.insertIfAbsent(SHOP, {
    subscriptionId: SUBSCRIPTION_ID,
    planHandle: "starter",
    planName: "Starter Plan",
    status: "PENDING",
    price: 10.25,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    test: true,
    trialDays: 0,
    confirmationUrl: "https://example.myshopify.com/admin/charges/confirm",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    cancelledAt: null,
    ...overrides,
  });

describe("reconcileWithShopify - page load correction", () => {
  it("reports no current subscription when Shopify and local store are empty", async () => {
    const store = createMemoryStore();

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([]),
    });

    assert.equal(report.current, null);
    assert.deepEqual(report.live, []);
    assert.deepEqual(report.corrections, []);
  });

  it("persists the live subscription when nothing is stored locally", async () => {
    const store = createMemoryStore();

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([gqlSubscription()]),
    });

    assert.equal(report.current.subscriptionId, SUBSCRIPTION_ID);
    assert.equal(report.current.status, "ACTIVE");
    assert.equal(report.current.planHandle, "starter");
    assert.equal(report.current.price, 10.25);

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "ACTIVE");
    assert.equal(
      report.corrections.some(
        (entry) =>
          entry.subscriptionId === SUBSCRIPTION_ID &&
          entry.from === "NONE" &&
          entry.to === "ACTIVE"
      ),
      true
    );
  });

  it("corrects a locally PENDING subscription to ACTIVE using live data", async () => {
    const store = createMemoryStore();
    await seedPendingRecord(store);

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([
        gqlSubscription({
          status: "ACTIVE",
          createdAt: "2026-10-01T10:00:00.000Z",
        }),
      ]),
    });

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "ACTIVE");
    assert.equal(stored.confirmationUrl, null);
    assert.equal(report.current.status, "ACTIVE");
    assert.deepEqual(report.corrections, [
      { subscriptionId: SUBSCRIPTION_ID, from: "PENDING", to: "ACTIVE" },
    ]);
  });

  it("marks a locally ACTIVE subscription CANCELLED when it is missing from the live response", async () => {
    const store = createMemoryStore();
    await seedPendingRecord(store, { status: "ACTIVE", confirmationUrl: null });

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([]),
    });

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "CANCELLED");
    assert.ok(stored.cancelledAt);
    assert.equal(report.current, null);
    assert.deepEqual(report.corrections, [
      { subscriptionId: SUBSCRIPTION_ID, from: "ACTIVE", to: "CANCELLED" },
    ]);
  });

  it("keeps a locally PENDING subscription untouched when the live query omits it", async () => {
    const store = createMemoryStore();
    await seedPendingRecord(store, {
      status: "PENDING",
      confirmationUrl: "https://confirm.example/pending",
    });

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([]),
    });

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.confirmationUrl, "https://confirm.example/pending");
    assert.deepEqual(report.corrections, []);
  });

  it("does not create duplicates or corrections when state already matches", async () => {
    const store = createMemoryStore();
    await seedPendingRecord(store, {
      status: "ACTIVE",
      confirmationUrl: null,
      updatedAt: "2026-10-01T10:00:00.000Z",
    });

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([gqlSubscription({ status: "ACTIVE" })]),
    });

    assert.equal(report.corrections.length, 0);
    assert.equal((await store.listForShop(SHOP)).length, 1);
    assert.equal(report.current.status, "ACTIVE");
  });

  it("prefers the most recently updated live subscription", async () => {
    const store = createMemoryStore();

    const olderId = "gid://shopify/AppSubscription/111";
    const newerId = "gid://shopify/AppSubscription/222";

    const report = await reconcileWithShopify({
      store,
      shop: SHOP,
      graphqlResponse: graphqlResponse([
        gqlSubscription({
          id: newerId,
          name: "Growth Plan",
          status: "ACTIVE",
          createdAt: "2026-10-02T10:00:00.000Z",
          updatedAt: "2026-10-02T10:00:00.000Z",
        }),
        gqlSubscription({
          id: olderId,
          status: "ACTIVE",
          createdAt: "2026-10-01T10:00:00.000Z",
        }),
      ]),
    });

    assert.equal(report.current.subscriptionId, newerId);
    assert.equal(report.current.planHandle, "growth");
  });
});
