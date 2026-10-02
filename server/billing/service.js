import { PLANS, getPlan, planHandleForName } from "./plans.js";

const BILLING_ERRORS = {
  NO_ACTIVE_SUBSCRIPTION: "NO_ACTIVE_SUBSCRIPTION",
  SUBSCRIPTION_PENDING: "SUBSCRIPTION_PENDING",
  UNKNOWN_PLAN: "UNKNOWN_PLAN",
  GRAPHQL_ERROR: "GRAPHQL_ERROR",
};

const CREATE_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateSubscription(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      trialDays: $trialDays
      test: $test
      replacementBehavior: $replacementBehavior
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
        name
        status
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
    }
  }
`;

const CURRENT_INSTALLATION_QUERY = /* GraphQL */ `
  query CurrentAppInstallation {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const formatUserErrors = (userErrors) =>
  userErrors.map((error) => error.message).join("; ");

const isInTrial = (record) => {
  if (!record?.trialDays || !record?.sourceCreatedAt) {
    return false;
  }
  const trialEndsAt =
    new Date(record.sourceCreatedAt).getTime() +
    record.trialDays * 24 * 60 * 60 * 1000;
  return Date.now() < trialEndsAt;
};

/**
 * Creates (or switches to) a subscription plan via appSubscriptionCreate.
 * On success the new subscription (PENDING until the merchant confirms) is
 * persisted to MongoDB and the confirmation URL is returned to the client.
 */
const createSubscription = async ({
  client,
  shop,
  store,
  planHandle,
  returnUrl,
}) => {
  const plan = getPlan(planHandle);
  if (!plan) {
    return {
      ok: false,
      code: BILLING_ERRORS.UNKNOWN_PLAN,
      message: `Unknown plan: ${planHandle}`,
    };
  }

  const response = await client.request(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name: plan.name,
      returnUrl,
      trialDays: plan.trialDays,
      test: true,
      replacementBehavior: "APPLY_IMMEDIATELY",
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: plan.price, currencyCode: plan.currencyCode },
              interval: plan.interval,
            },
          },
        },
      ],
    },
  });

  const payload = response?.data?.appSubscriptionCreate;
  if (!payload) {
    return {
      ok: false,
      code: BILLING_ERRORS.GRAPHQL_ERROR,
      message: "Shopify did not return a subscription payload",
    };
  }
  if (payload.userErrors?.length > 0) {
    return {
      ok: false,
      code: BILLING_ERRORS.GRAPHQL_ERROR,
      message: formatUserErrors(payload.userErrors),
    };
  }

  const subscription = payload.appSubscription;
  const now = new Date();
  await store.upsert(shop, {
    subscriptionId: subscription.id,
    plan: plan.handle,
    planName: plan.name,
    status: subscription.status,
    test: true,
    trialDays: plan.trialDays,
    price: { amount: plan.price, currencyCode: plan.currencyCode },
    sourceCreatedAt: now,
    sourceUpdatedAt: now,
    cancelledAt: null,
  });

  return {
    ok: true,
    confirmationUrl: payload.confirmationUrl,
    subscriptionId: subscription.id,
    status: subscription.status,
  };
};

/**
 * Cancels the shop's current subscription via appSubscriptionCancel.
 *
 * Edge cases:
 *  - No local ACTIVE/PENDING subscription -> NO_ACTIVE_SUBSCRIPTION.
 *  - A PENDING subscription exists -> SUBSCRIPTION_PENDING, Shopify cannot
 *    cancel a subscription the merchant has not accepted yet.
 *  - Subscription inside its trial period -> cancelled normally, the
 *    response is flagged with `inTrial: true`.
 *
 * If Shopify returns userErrors, the previous local state is re-persisted
 * (rolled back) and a readable error code is returned.
 */
const cancelSubscription = async ({ client, shop, store }) => {
  const current = await store.findCurrent(shop);
  if (!current) {
    return {
      ok: false,
      code: BILLING_ERRORS.NO_ACTIVE_SUBSCRIPTION,
      message: "This shop has no active subscription to cancel",
    };
  }
  if (current.status === "PENDING") {
    return {
      ok: false,
      code: BILLING_ERRORS.SUBSCRIPTION_PENDING,
      message:
        "The subscription is still pending merchant confirmation and cannot be cancelled yet",
    };
  }

  const wasInTrial = isInTrial(current);

  const response = await client.request(CANCEL_SUBSCRIPTION_MUTATION, {
    variables: { id: current.subscriptionId },
  });

  const payload = response?.data?.appSubscriptionCancel;
  if (!payload) {
    return {
      ok: false,
      code: BILLING_ERRORS.GRAPHQL_ERROR,
      message: "Shopify did not return a cancellation payload",
    };
  }
  if (payload.userErrors?.length > 0) {
    // Roll back local state: re-persist the pre-cancel snapshot so MongoDB
    // never reflects a cancellation Shopify rejected.
    await store.upsert(shop, { ...current });
    return {
      ok: false,
      code: BILLING_ERRORS.GRAPHQL_ERROR,
      message: formatUserErrors(payload.userErrors),
    };
  }

  const cancelled = payload.appSubscription;
  const now = new Date();
  await store.upsert(shop, {
    subscriptionId: cancelled.id,
    plan: current.plan,
    planName: current.planName,
    status: cancelled.status,
    test: current.test,
    trialDays: current.trialDays,
    price: current.price,
    sourceCreatedAt: current.sourceCreatedAt,
    sourceUpdatedAt: now,
    cancelledAt: now,
  });

  return {
    ok: true,
    subscriptionId: cancelled.id,
    status: cancelled.status,
    inTrial: wasInTrial,
    message: wasInTrial
      ? "Subscription cancelled during the trial period - no charges will be made"
      : "Subscription cancelled",
  };
};

/**
 * Persists an APP_SUBSCRIPTIONS_UPDATE webhook payload.
 *
 * Idempotent per subscription id: redeliveries of the same (or an older)
 * event are detected by comparing `updated_at` against the stored
 * `sourceUpdatedAt` and dropped, so duplicates never create a second record
 * or resurrect stale state.
 */
const recordSubscriptionUpdate = async ({ shop, body, store }) => {
  const subscription = body?.app_subscription;
  if (!subscription?.admin_graphql_api_id) {
    return { applied: false, reason: "invalid_payload" };
  }

  const subscriptionId = subscription.admin_graphql_api_id;
  const updatedAt = new Date(subscription.updated_at);

  const existing = await store.findBySubscriptionId(shop, subscriptionId);
  if (
    existing?.sourceUpdatedAt &&
    new Date(existing.sourceUpdatedAt).getTime() >= updatedAt.getTime()
  ) {
    return { applied: false, reason: "duplicate_or_stale" };
  }

  await store.upsert(shop, {
    subscriptionId,
    plan: planHandleForName(subscription.name),
    planName: subscription.name,
    status: subscription.status,
    price: {
      amount: Number(subscription.price),
      currencyCode: subscription.currency,
    },
    sourceCreatedAt: subscription.created_at
      ? new Date(subscription.created_at)
      : existing?.sourceCreatedAt,
    sourceUpdatedAt: updatedAt,
    ...(subscription.status === "CANCELLED" ? { cancelledAt: updatedAt } : {}),
  });

  return { applied: true, subscriptionId, status: subscription.status };
};

/**
 * Corrects local state against Shopify's live `currentAppInstallation`
 * query. Active subscriptions are upserted; local records that claim to be
 * ACTIVE but are no longer returned by Shopify are marked CANCELLED.
 *
 * Existing `sourceUpdatedAt` values are preserved so the webhook ordering
 * guard keeps working after a sync.
 */
const syncFromShopify = async ({ client, shop, store }) => {
  const response = await client.request(CURRENT_INSTALLATION_QUERY);
  const activeSubscriptions =
    response?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  for (const subscription of activeSubscriptions) {
    const pricing =
      subscription.lineItems?.[0]?.plan?.pricingDetails?.price ?? null;
    const existing = await store.findBySubscriptionId(shop, subscription.id);
    await store.upsert(shop, {
      subscriptionId: subscription.id,
      plan: planHandleForName(subscription.name),
      planName: subscription.name,
      status: subscription.status,
      test: subscription.test ?? true,
      trialDays: subscription.trialDays ?? 0,
      price: pricing
        ? { amount: Number(pricing.amount), currencyCode: pricing.currencyCode }
        : existing?.price,
      sourceCreatedAt: subscription.createdAt
        ? new Date(subscription.createdAt)
        : existing?.sourceCreatedAt,
      sourceUpdatedAt:
        existing?.sourceUpdatedAt ??
        (subscription.createdAt
          ? new Date(subscription.createdAt)
          : new Date()),
      cancelledAt: null,
    });
  }

  const localCurrent = await store.findCurrent(shop);
  if (
    localCurrent &&
    localCurrent.status === "ACTIVE" &&
    !activeSubscriptions.some(
      (subscription) => subscription.id === localCurrent.subscriptionId
    )
  ) {
    await store.upsert(shop, {
      subscriptionId: localCurrent.subscriptionId,
      status: "CANCELLED",
      cancelledAt: new Date(),
    });
  }

  const current = await store.findCurrent(shop);
  return {
    subscription: current,
    inTrial: isInTrial(current),
    plans: PLANS,
  };
};

export {
  BILLING_ERRORS,
  createSubscription,
  cancelSubscription,
  recordSubscriptionUpdate,
  syncFromShopify,
  isInTrial,
};
