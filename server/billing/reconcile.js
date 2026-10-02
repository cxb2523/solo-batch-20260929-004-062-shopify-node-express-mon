import {
  isLiveSubscription,
  normalizeGraphqlSubscription,
} from "./normalize.js";

/**
 * @typedef {Object} ReconcileReport
 * @property {any[]} live - Subscriptions Shopify currently reports (PENDING/ACTIVE).
 * @property {any | null} current - The most current live subscription, if any.
 * @property {Array<{subscriptionId: string, from: string, to: string}>} corrections
 *   Local records that were updated to match Shopify.
 */

/**
 * Reconciles stored subscription state with a live
 * currentAppInstallation response.
 *
 * Shopify is the source of truth: every subscription present in the live
 * response upserts the local record (using Shopify timestamps), and any local
 * PENDING/ACTIVE record missing from the live response is marked CANCELLED.
 *
 * @param {Object} params
 * @param {any} params.store - Subscription store.
 * @param {string} params.shop - Shop domain.
 * @param {any} params.graphqlResponse - Raw Admin GraphQL response.
 * @returns {Promise<ReconcileReport>}
 */
export const reconcileWithShopify = async ({
  store,
  shop,
  graphqlResponse,
}) => {
  const liveNodes =
    graphqlResponse?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const liveSubscriptions = liveNodes
    .map(normalizeGraphqlSubscription)
    .filter(Boolean);

  const corrections = [];
  const liveIds = new Set();

  for (const subscription of liveSubscriptions) {
    liveIds.add(subscription.subscriptionId);
    const { subscriptionId, updatedAt, ...data } = subscription;

    const before = await store.findBySubscriptionId(shop, subscriptionId);
    const result = await store.upsertIfNewer(
      shop,
      { subscriptionId, ...data },
      updatedAt ?? new Date().toISOString()
    );

    if (!result.stale) {
      // Live Shopify data is authoritative: correct status even when the
      // updated_at timestamp ties (or the webhook missed the transition).
      if (before?.status !== data.status) {
        if (result.duplicate || result.record?.status !== data.status) {
          await store.updateBySubscriptionId(shop, subscriptionId, {
            status: data.status,
            ...(data.status === "ACTIVE" ? { confirmationUrl: null } : {}),
          });
        }
        corrections.push({
          subscriptionId,
          from: before?.status ?? "NONE",
          to: data.status,
        });
      }
    }
  }

  const stored = await store.listForShop(shop);
  for (const record of stored) {
    // Only ACTIVE records are corrected to CANCELLED when missing from the
    // live response: activeSubscriptions may omit not-yet-approved PENDING
    // subscriptions, which the APP_SUBSCRIPTIONS_UPDATE webhook resolves.
    if (record.status === "ACTIVE" && !liveIds.has(record.subscriptionId)) {
      const cancelledAt = new Date().toISOString();
      await store.updateBySubscriptionId(shop, record.subscriptionId, {
        status: "CANCELLED",
        confirmationUrl: null,
        cancelledAt,
        updatedAt: cancelledAt,
      });
      corrections.push({
        subscriptionId: record.subscriptionId,
        from: record.status,
        to: "CANCELLED",
      });
    }
  }

  const live = liveSubscriptions
    .filter((subscription) => isLiveSubscription(subscription))
    .sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0));

  const current = (await store.findLive(shop)) ?? live[0] ?? null;

  return { live, current, corrections };
};

export default reconcileWithShopify;
