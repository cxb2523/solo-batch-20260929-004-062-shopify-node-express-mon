import createMongoStore from "../billing/mongoStore.js";
import applySubscriptionUpdate from "../billing/webhookSync.js";

const store = createMongoStore();

/**
 * @typedef { import("../../_developer/types/2026-07/webhooks.js").APP_SUBSCRIPTIONS_UPDATE } webhookTopic
 */

/**
 * APP_SUBSCRIPTIONS_UPDATE webhook. Idempotent by subscription id and ordered
 * by updated_at (see server/billing/webhookSync.js).
 */
const appSubscriptionsUpdateHandler = async (
  topic,
  shop,
  webhookRequestBody,
  webhookId,
  apiVersion
) => {
  /** @type {webhookTopic} */
  const payload = JSON.parse(webhookRequestBody);

  const result = await applySubscriptionUpdate({ store, shop, payload });

  if (result.invalid) {
    console.warn(
      `--> APP_SUBSCRIPTIONS_UPDATE for ${shop} had no app_subscription payload`
    );
    return { duplicate: false, stale: false, invalid: true };
  }

  if (result.duplicate) {
    console.log(
      `--> Ignoring duplicate APP_SUBSCRIPTIONS_UPDATE for ${result.record.subscriptionId} (${shop})`
    );
  } else if (result.stale) {
    console.log(
      `--> Ignoring stale APP_SUBSCRIPTIONS_UPDATE for ${result.record.subscriptionId} (${shop})`
    );
  }

  return result;
};

export default appSubscriptionsUpdateHandler;
