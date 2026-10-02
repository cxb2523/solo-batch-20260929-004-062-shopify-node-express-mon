import {
  CANCEL_SUBSCRIPTION_MUTATION,
  CREATE_SUBSCRIPTION_MUTATION,
} from "./graphql.js";
import { BillingError, toBillingError } from "./errors.js";
import {
  buildCreatedRecord,
  isLiveSubscription,
  normalizeStatus,
} from "./normalize.js";
import { getPlan } from "./plans.js";

/**
 * Creates an app subscription via appSubscriptionCreate and writes the PENDING
 * record to the store. Throws a BillingError when the shop already has a
 * PENDING or ACTIVE subscription, or when Shopify rejects the mutation.
 *
 * @param {Object} params
 * @param {any} params.client - Offline Admin GraphQL client.
 * @param {any} params.store - Subscription store.
 * @param {string} params.shop - Shop domain.
 * @param {string} params.planHandle - Plan handle from plans.js.
 * @param {string} params.returnUrl - URL Shopify redirects to after approval.
 * @param {boolean} [params.cancelActive=false] - Cancel an existing ACTIVE
 *   subscription before creating the new one (plan switch).
 */
export const createSubscription = async ({
  client,
  store,
  shop,
  planHandle,
  returnUrl,
  cancelActive = false,
}) => {
  const plan = getPlan(planHandle);
  if (!plan) {
    throw new BillingError("INVALID_PLAN", { details: { planHandle } });
  }

  const live = await store.findLive(shop);
  if (live?.status === "PENDING") {
    throw new BillingError("PENDING_SUBSCRIPTION_EXISTS", {
      details: {
        subscriptionId: live.subscriptionId,
        confirmationUrl: live.confirmationUrl ?? null,
      },
    });
  }
  if (live?.status === "ACTIVE" && !cancelActive) {
    throw new BillingError("ACTIVE_SUBSCRIPTION_CONFLICT", {
      details: { subscriptionId: live.subscriptionId },
    });
  }

  // Plan switch: cancel the current subscription with appSubscriptionCancel
  // before creating the replacement. If the create mutation fails afterwards
  // the old record is restored and a follow-up reconciliation fixes drift.
  let switchedFrom = null;
  if (live?.status === "ACTIVE" && cancelActive) {
    switchedFrom = live;
    let cancelResponse;
    try {
      cancelResponse = await client.request(CANCEL_SUBSCRIPTION_MUTATION, {
        variables: { id: live.subscriptionId },
      });
    } catch (error) {
      throw toBillingError(error);
    }

    const cancelPayload = cancelResponse?.data?.appSubscriptionCancel;
    if (!cancelPayload || cancelPayload.userErrors?.length > 0) {
      throw new BillingError("GRAPHQL_USER_ERROR", {
        details: {
          mutation: "appSubscriptionCancel",
          userErrors: cancelPayload?.userErrors,
        },
      });
    }

    const cancelledAt = new Date().toISOString();
    await store.updateBySubscriptionId(shop, live.subscriptionId, {
      status: "CANCELLED",
      confirmationUrl: null,
      cancelledAt,
      updatedAt: cancelledAt,
    });
  }

  /** Restores the switched-away subscription when create fails. */
  const restoreSwitched = async () => {
    if (!switchedFrom) {
      return;
    }
    await store.updateBySubscriptionId(shop, switchedFrom.subscriptionId, {
      status: switchedFrom.status,
      confirmationUrl: switchedFrom.confirmationUrl ?? null,
      cancelledAt: switchedFrom.cancelledAt ?? null,
      updatedAt: switchedFrom.updatedAt ?? null,
    });
  };

  const variables = {
    name: plan.name,
    returnUrl,
    test: true,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: plan.price,
              currencyCode: plan.currencyCode,
            },
            interval: plan.interval,
          },
        },
      },
    ],
    ...(plan.trialDays > 0 ? { trialDays: plan.trialDays } : {}),
  };

  let response;
  try {
    response = await client.request(CREATE_SUBSCRIPTION_MUTATION, {
      variables,
    });
  } catch (error) {
    await restoreSwitched();
    throw toBillingError(error);
  }

  const payload = response?.data?.appSubscriptionCreate;
  if (!payload || payload.userErrors?.length > 0) {
    await restoreSwitched();
    throw new BillingError("GRAPHQL_USER_ERROR", {
      details: {
        mutation: "appSubscriptionCreate",
        userErrors: payload?.userErrors,
      },
    });
  }

  const appSubscription = payload.appSubscription;
  if (!appSubscription?.id) {
    await restoreSwitched();
    throw new BillingError("GRAPHQL_USER_ERROR", {
      details: {
        mutation: "appSubscriptionCreate",
        missing: "appSubscription",
      },
    });
  }

  const record = buildCreatedRecord(
    appSubscription,
    plan.handle,
    payload.confirmationUrl
  );
  await store.upsertIfNewer(shop, record, record.updatedAt);

  return {
    confirmationUrl: payload.confirmationUrl,
    subscription: record,
    switched: Boolean(switchedFrom),
  };
};

/**
 * Cancels an app subscription via appSubscriptionCancel.
 *
 * The local record is optimistically marked CANCELLED before the request and
 * rolled back if GraphQL fails, so the page never shows a cancelled state that
 * Shopify did not accept.
 *
 * @param {Object} params
 * @param {any} params.client - Offline Admin GraphQL client.
 * @param {any} params.store - Subscription store.
 * @param {string} params.shop - Shop domain.
 * @param {string} [params.subscriptionId] - Target id; falls back to the live record.
 */
export const cancelSubscription = async ({
  client,
  store,
  shop,
  subscriptionId,
}) => {
  const requestedId =
    subscriptionId ?? (await store.findLive(shop))?.subscriptionId;

  if (!requestedId) {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION");
  }

  const target = await store.findBySubscriptionId(shop, requestedId);
  if (!target) {
    throw new BillingError("SUBSCRIPTION_NOT_FOUND", {
      details: { subscriptionId: requestedId },
    });
  }
  if (!isLiveSubscription(target)) {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION", {
      details: { subscriptionId: requestedId, status: target.status },
    });
  }

  const cancelledAt = new Date().toISOString();
  const optimisticPatch = {
    status: "CANCELLED",
    confirmationUrl: null,
    cancelledAt,
    updatedAt: cancelledAt,
  };
  await store.updateBySubscriptionId(shop, requestedId, optimisticPatch);

  const rollback = async () => {
    await store.updateBySubscriptionId(shop, requestedId, {
      status: target.status,
      confirmationUrl: target.confirmationUrl ?? null,
      cancelledAt: target.cancelledAt ?? null,
      updatedAt: target.updatedAt ?? null,
    });
  };

  let response;
  try {
    response = await client.request(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: requestedId },
    });
  } catch (error) {
    await rollback();
    throw toBillingError(error);
  }

  const payload = response?.data?.appSubscriptionCancel;
  if (!payload || payload.userErrors?.length > 0) {
    await rollback();
    throw new BillingError("GRAPHQL_USER_ERROR", {
      details: {
        mutation: "appSubscriptionCancel",
        userErrors: payload?.userErrors,
      },
    });
  }

  const finalStatus =
    normalizeStatus(payload.appSubscription?.status) ?? "CANCELLED";
  const record = await store.updateBySubscriptionId(shop, requestedId, {
    ...optimisticPatch,
    status: finalStatus,
  });

  return { subscription: record };
};
