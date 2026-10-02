import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BillingError } from "./errors.js";
import {
  CANCEL_SUBSCRIPTION_MUTATION,
  CREATE_SUBSCRIPTION_MUTATION,
} from "./graphql.js";
import createMemoryStore from "./memoryStore.js";
import { cancelSubscription, createSubscription } from "./service.js";

const SHOP = "test-store.myshopify.com";
const SUBSCRIPTION_ID = "gid://shopify/AppSubscription/4096";
const RETURN_URL = "https://app.example.com/debug/billing";

const createSuccessClient = (overrides = {}) => ({
  request: async (document, options) => {
    assert.equal(document, CREATE_SUBSCRIPTION_MUTATION);
    assert.equal(options.variables.name, "Starter Plan");
    return {
      data: {
        appSubscriptionCreate: {
          userErrors: [],
          confirmationUrl: "https://confirm.example/123",
          appSubscription: {
            id: SUBSCRIPTION_ID,
            status: "PENDING",
          },
        },
      },
      ...overrides,
    };
  },
});

const cancelClient = (handler) => ({
  request: async (document, options) => {
    assert.equal(document, CANCEL_SUBSCRIPTION_MUTATION);
    assert.equal(options.variables.id, SUBSCRIPTION_ID);
    return handler();
  },
});

const seedRecord = (store, overrides = {}) =>
  store.insertIfAbsent(SHOP, {
    subscriptionId: SUBSCRIPTION_ID,
    planHandle: "starter",
    planName: "Starter Plan",
    status: "ACTIVE",
    price: 10.25,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    test: true,
    trialDays: 0,
    confirmationUrl: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    cancelledAt: null,
    ...overrides,
  });

describe("createSubscription", () => {
  it("returns the confirmation URL and persists a PENDING record", async () => {
    const store = createMemoryStore();

    const result = await createSubscription({
      client: createSuccessClient(),
      store,
      shop: SHOP,
      planHandle: "starter",
      returnUrl: RETURN_URL,
    });

    assert.equal(result.confirmationUrl, "https://confirm.example/123");
    assert.equal(result.subscription.subscriptionId, SUBSCRIPTION_ID);
    assert.equal(result.subscription.status, "PENDING");
    assert.equal(result.subscription.planHandle, "starter");
    assert.ok(result.subscription.updatedAt);

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.confirmationUrl, "https://confirm.example/123");
  });

  it("passes trialDays only for plans with a trial", async () => {
    const store = createMemoryStore();
    let captured;
    const client = {
      request: async (document, options) => {
        captured = options.variables;
        return {
          data: {
            appSubscriptionCreate: {
              userErrors: [],
              confirmationUrl: "https://confirm.example/456",
              appSubscription: { id: SUBSCRIPTION_ID, status: "PENDING" },
            },
          },
        };
      },
    };

    await createSubscription({
      client,
      store,
      shop: SHOP,
      planHandle: "growth",
      returnUrl: RETURN_URL,
    });
    assert.equal(captured.trialDays, 7);

    await createSubscription({
      client,
      store: createMemoryStore(),
      shop: SHOP,
      planHandle: "starter",
      returnUrl: RETURN_URL,
    });
    assert.equal(captured.trialDays, undefined);
  });

  it("rejects an unknown plan without calling GraphQL", async () => {
    const store = createMemoryStore();
    const client = {
      request: async () => assert.fail("GraphQL must not be called"),
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "does-not-exist",
        returnUrl: RETURN_URL,
      }),
      (error) => {
        assert.ok(error instanceof BillingError);
        assert.equal(error.code, "INVALID_PLAN");
        assert.equal(error.status, 400);
        return true;
      }
    );
  });

  it("refuses when a PENDING subscription already exists and exposes its confirmation URL", async () => {
    const store = createMemoryStore();
    await seedRecord(store, {
      status: "PENDING",
      confirmationUrl: "https://confirm.example/existing",
    });
    const client = {
      request: async () => assert.fail("GraphQL must not be called"),
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "starter",
        returnUrl: RETURN_URL,
      }),
      (error) => {
        assert.equal(error.code, "PENDING_SUBSCRIPTION_EXISTS");
        assert.equal(
          error.details.confirmationUrl,
          "https://confirm.example/existing"
        );
        return true;
      }
    );
  });

  it("refuses when an ACTIVE subscription already exists", async () => {
    const store = createMemoryStore();
    await seedRecord(store);
    const client = {
      request: async () => assert.fail("GraphQL must not be called"),
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "starter",
        returnUrl: RETURN_URL,
      }),
      (error) => {
        assert.equal(error.code, "ACTIVE_SUBSCRIPTION_CONFLICT");
        assert.equal(error.status, 409);
        return true;
      }
    );
  });

  it("maps GraphQL userErrors to GRAPHQL_USER_ERROR", async () => {
    const store = createMemoryStore();
    const client = {
      request: async () => ({
        data: {
          appSubscriptionCreate: {
            userErrors: [{ field: ["test"], message: "Test mode invalid" }],
            confirmationUrl: null,
            appSubscription: null,
          },
        },
      }),
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "starter",
        returnUrl: RETURN_URL,
      }),
      (error) => {
        assert.equal(error.code, "GRAPHQL_USER_ERROR");
        assert.equal(error.status, 502);
        assert.equal(error.details.userErrors[0].message, "Test mode invalid");
        return true;
      }
    );

    assert.deepEqual(await store.listForShop(SHOP), []);
  });

  it("maps a transport failure to GRAPHQL_REQUEST_FAILED", async () => {
    const store = createMemoryStore();
    const client = {
      request: async () => {
        const error = new Error("socket hang up");
        error.response = { statusCode: 500 };
        throw error;
      },
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "starter",
        returnUrl: RETURN_URL,
      }),
      (error) => {
        assert.equal(error.code, "GRAPHQL_REQUEST_FAILED");
        return true;
      }
    );
  });

  it("switches plans by cancelling the ACTIVE subscription first and restoring it on create failure", async () => {
    const store = createMemoryStore();
    await seedRecord(store, {
      status: "ACTIVE",
      updatedAt: "2026-10-01T09:00:00.000Z",
    });

    let cancelCalled = false;
    const client = {
      request: async (document) => {
        if (document === CANCEL_SUBSCRIPTION_MUTATION) {
          cancelCalled = true;
          return {
            data: {
              appSubscriptionCancel: {
                userErrors: [],
                appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
              },
            },
          };
        }

        return {
          data: {
            appSubscriptionCreate: {
              userErrors: [{ field: [], message: "boom" }],
              confirmationUrl: null,
              appSubscription: null,
            },
          },
        };
      },
    };

    await assert.rejects(
      createSubscription({
        client,
        store,
        shop: SHOP,
        planHandle: "growth",
        returnUrl: RETURN_URL,
        cancelActive: true,
      }),
      (error) => {
        assert.equal(error.code, "GRAPHQL_USER_ERROR");
        return true;
      }
    );

    assert.equal(cancelCalled, true, "old subscription was cancelled first");
    const restored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(restored.status, "ACTIVE", "old subscription restored");
    assert.equal(restored.cancelledAt, null);
    assert.equal(restored.updatedAt, "2026-10-01T09:00:00.000Z");
  });

  it("switches plans successfully and keeps the old record CANCELLED", async () => {
    const store = createMemoryStore();
    await seedRecord(store, { status: "ACTIVE" });

    const newId = "gid://shopify/AppSubscription/8192";
    const calls = [];
    const client = {
      request: async (document) => {
        calls.push(document);
        if (document === CANCEL_SUBSCRIPTION_MUTATION) {
          return {
            data: {
              appSubscriptionCancel: {
                userErrors: [],
                appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
              },
            },
          };
        }
        return {
          data: {
            appSubscriptionCreate: {
              userErrors: [],
              confirmationUrl: "https://confirm.example/switch",
              appSubscription: { id: newId, status: "PENDING" },
            },
          },
        };
      },
    };

    const result = await createSubscription({
      client,
      store,
      shop: SHOP,
      planHandle: "growth",
      returnUrl: RETURN_URL,
      cancelActive: true,
    });

    assert.equal(calls[0], CANCEL_SUBSCRIPTION_MUTATION);
    assert.equal(calls[1], CREATE_SUBSCRIPTION_MUTATION);
    assert.equal(result.switched, true);
    assert.equal(result.subscription.subscriptionId, newId);

    const old = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(old.status, "CANCELLED");
    const fresh = await store.findLive(SHOP);
    assert.equal(fresh.subscriptionId, newId);
  });
});

describe("cancelSubscription", () => {
  it("returns NO_ACTIVE_SUBSCRIPTION when there is no subscription", async () => {
    const store = createMemoryStore();
    const client = {
      request: async () => assert.fail("GraphQL must not be called"),
    };

    await assert.rejects(
      cancelSubscription({ client, store, shop: SHOP }),
      (error) => {
        assert.equal(error.code, "NO_ACTIVE_SUBSCRIPTION");
        assert.equal(error.status, 409);
        return true;
      }
    );
  });

  it("cancels a PENDING subscription", async () => {
    const store = createMemoryStore();
    await seedRecord(store, {
      status: "PENDING",
      confirmationUrl: "https://confirm.example/pending",
    });
    const client = cancelClient(() => ({
      data: {
        appSubscriptionCancel: {
          userErrors: [],
          appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
        },
      },
    }));

    const result = await cancelSubscription({ client, store, shop: SHOP });

    assert.equal(result.subscription.status, "CANCELLED");
    assert.ok(result.subscription.cancelledAt);
    assert.equal(result.subscription.confirmationUrl, null);

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "CANCELLED");
    assert.equal(stored.confirmationUrl, null);
  });

  it("cancels an ACTIVE subscription inside its trial period", async () => {
    const store = createMemoryStore();
    await seedRecord(store, { status: "ACTIVE", trialDays: 14 });

    let called = false;
    const client = cancelClient(() => {
      called = true;
      return {
        data: {
          appSubscriptionCancel: {
            userErrors: [],
            appSubscription: { id: SUBSCRIPTION_ID, status: "CANCELLED" },
          },
        },
      };
    });

    const result = await cancelSubscription({
      client,
      store,
      shop: SHOP,
      subscriptionId: SUBSCRIPTION_ID,
    });

    assert.equal(called, true, "appSubscriptionCancel is called during trial");
    assert.equal(result.subscription.status, "CANCELLED");
  });

  it("returns NO_ACTIVE_SUBSCRIPTION when the stored subscription is already CANCELLED", async () => {
    const store = createMemoryStore();
    await seedRecord(store, { status: "CANCELLED" });
    const client = {
      request: async () => assert.fail("GraphQL must not be called"),
    };

    await assert.rejects(
      cancelSubscription({
        client,
        store,
        shop: SHOP,
        subscriptionId: SUBSCRIPTION_ID,
      }),
      (error) => {
        assert.equal(error.code, "NO_ACTIVE_SUBSCRIPTION");
        return true;
      }
    );
  });

  it("rolls back local state when the cancel mutation returns userErrors", async () => {
    const store = createMemoryStore();
    await seedRecord(store);
    const client = cancelClient(() => ({
      data: {
        appSubscriptionCancel: {
          userErrors: [{ field: ["id"], message: "Cannot cancel" }],
          appSubscription: null,
        },
      },
    }));

    await assert.rejects(
      cancelSubscription({ client, store, shop: SHOP }),
      (error) => {
        assert.equal(error.code, "GRAPHQL_USER_ERROR");
        return true;
      }
    );

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "ACTIVE", "optimistic state rolled back");
    assert.equal(stored.cancelledAt, null);
    assert.equal(stored.updatedAt, "2026-10-01T10:00:00.000Z");
  });

  it("rolls back local state when the GraphQL request throws", async () => {
    const store = createMemoryStore();
    await seedRecord(store, {
      status: "PENDING",
      confirmationUrl: "https://confirm.example/rollback",
    });
    const client = cancelClient(() => {
      throw new Error("network down");
    });

    await assert.rejects(
      cancelSubscription({ client, store, shop: SHOP }),
      (error) => {
        assert.equal(error.code, "GRAPHQL_REQUEST_FAILED");
        return true;
      }
    );

    const stored = await store.findBySubscriptionId(SHOP, SUBSCRIPTION_ID);
    assert.equal(stored.status, "PENDING", "optimistic state rolled back");
    assert.equal(stored.confirmationUrl, "https://confirm.example/rollback");
    assert.equal(stored.cancelledAt, null);
  });
});
