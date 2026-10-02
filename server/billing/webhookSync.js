import { normalizeWebhookSubscription } from "./normalize.js";

/**
 * @typedef {Object} ApplyEventResult
 * @property {any | null} record - The current record after processing.
 * @property {boolean} duplicate - Same subscription id + updated_at redelivered.
 * @property {boolean} stale - Out-of-order event with an older updated_at.
 * @property {boolean} invalid - Payload could not be normalized.
 */

/**
 * Applies an APP_SUBSCRIPTIONS_UPDATE payload to the store.
 *
 * Idempotency contract:
 * - keyed on the subscription id, so redeliveries never insert a second record
 * - events with an older `updated_at` than what we stored are discarded
 * - redeliveries carrying the exact same `updated_at` are treated as duplicates
 *
 * @param {Object} params
 * @param {any} params.store - Subscription store (memory or Mongo backed).
 * @param {string} params.shop - Shop domain from the webhook header.
 * @param {any} params.payload - Parsed webhook body.
 * @returns {Promise<ApplyEventResult>}
 */
export const applySubscriptionUpdate = async ({ store, shop, payload }) => {
  const normalized = normalizeWebhookSubscription(payload?.app_subscription);

  if (!normalized) {
    return { record: null, duplicate: false, stale: false, invalid: true };
  }

  const { subscriptionId, updatedAt, ...data } = normalized;

  const { record, duplicate, stale } = await store.upsertIfNewer(
    shop,
    { subscriptionId, ...data },
    updatedAt
  );

  return { record, duplicate, stale, invalid: false };
};

export default applySubscriptionUpdate;
