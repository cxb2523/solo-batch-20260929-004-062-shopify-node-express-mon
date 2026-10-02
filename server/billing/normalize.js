import { findPlanByName, getPlan } from "./plans.js";

/**
 * Subscription statuses Shopify reports for an app subscription.
 */
export const SUBSCRIPTION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "DECLINED",
  "EXPIRED",
  "FROZEN",
  "CANCELLED",
];

const ACTIVE_STATUSES = new Set(["PENDING", "ACTIVE"]);

/**
 * @param {string | undefined | null} status
 * @returns {string | null}
 */
export const normalizeStatus = (status) =>
  SUBSCRIPTION_STATUSES.includes(status) ? status : null;

/**
 * A PENDING subscription still blocks new subscriptions (Shopify will reject
 * appSubscriptionCreate with an active/pending one), so both count as live.
 * @param {{ status?: string | null } | null | undefined} subscription
 */
export const isLiveSubscription = (subscription) =>
  ACTIVE_STATUSES.has(subscription?.status);

/**
 * Normalizes the `currentAppInstallation.activeSubscriptions` node returned by
 * the Admin GraphQL query into the shape stored in MongoDB / sent to the page.
 * @param {any} node
 */
export const normalizeGraphqlSubscription = (node) => {
  if (!node?.id) {
    return null;
  }

  const pricingDetails = node.lineItems?.[0]?.plan?.pricingDetails;
  const price = pricingDetails?.price;
  const plan = findPlanByName(node.name);

  return {
    subscriptionId: node.id,
    planHandle: plan?.handle ?? null,
    planName: node.name ?? plan?.name ?? null,
    status: normalizeStatus(node.status) ?? "ACTIVE",
    price: price ? Number(price.amount) : (plan?.price ?? null),
    currencyCode: price?.currencyCode ?? plan?.currencyCode ?? null,
    interval: pricingDetails?.interval ?? plan?.interval ?? null,
    test: typeof node.test === "boolean" ? node.test : true,
    trialDays: pricingDetails?.trialDays ?? plan?.trialDays ?? null,
    createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : null,
    updatedAt: node.updatedAt ? new Date(node.updatedAt).toISOString() : null,
  };
};

/**
 * Normalizes the `app_subscription` object of an APP_SUBSCRIPTIONS_UPDATE
 * webhook payload.
 * @param {any} appSubscription
 */
export const normalizeWebhookSubscription = (appSubscription) => {
  if (!appSubscription?.admin_graphql_api_id) {
    return null;
  }

  const status = normalizeStatus(String(appSubscription.status).toUpperCase());
  const plan = findPlanByName(appSubscription.name);

  return {
    subscriptionId: appSubscription.admin_graphql_api_id,
    planHandle: plan?.handle ?? appSubscription.plan_handle ?? null,
    planName: appSubscription.name ?? plan?.name ?? null,
    status,
    price: appSubscription.price ? Number(appSubscription.price) : null,
    currencyCode: appSubscription.currency ?? null,
    interval: appSubscription.interval ?? plan?.interval ?? null,
    test: true,
    trialDays: plan?.trialDays ?? null,
    createdAt: appSubscription.created_at
      ? new Date(appSubscription.created_at).toISOString()
      : null,
    updatedAt: appSubscription.updated_at
      ? new Date(appSubscription.updated_at).toISOString()
      : null,
  };
};

/**
 * Normalizes an appSubscriptionCreate result into a stored record.
 * @param {{ id: string, status?: string }} appSubscription
 * @param {string} planHandle
 * @param {string} [confirmationUrl]
 */
export const buildCreatedRecord = (
  appSubscription,
  planHandle,
  confirmationUrl
) => {
  const plan = getPlan(planHandle);
  const now = new Date().toISOString();

  return {
    subscriptionId: appSubscription.id,
    planHandle: plan.handle,
    planName: plan.name,
    status: normalizeStatus(appSubscription.status) ?? "PENDING",
    price: plan.price,
    currencyCode: plan.currencyCode,
    interval: plan.interval,
    test: true,
    trialDays: plan.trialDays,
    confirmationUrl: confirmationUrl ?? null,
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
  };
};

/**
 * Strips store-only fields before sending a subscription to the client.
 * @param {any} record
 */
export const toPublicSubscription = (record) => {
  if (!record) {
    return null;
  }

  return {
    subscriptionId: record.subscriptionId,
    planHandle: record.planHandle,
    planName: record.planName,
    status: record.status,
    price: record.price,
    currencyCode: record.currencyCode,
    interval: record.interval,
    test: record.test,
    trialDays: record.trialDays,
    confirmationUrl: record.confirmationUrl ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cancelledAt: record.cancelledAt ?? null,
  };
};
