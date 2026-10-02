import { recordSubscriptionUpdate } from "../billing/service.js";
import { subscriptionStore } from "../billing/store.js";

/**
 * @typedef { import("../../_developer/types/2026-07/webhooks.js").APP_SUBSCRIPTIONS_UPDATE } webhookTopic
 */

const appSubscriptionsUpdateHandler = async (
  topic,
  shop,
  webhookRequestBody,
  webhookId,
  apiVersion
) => {
  /** @type {webhookTopic} */
  const webhookBody = JSON.parse(webhookRequestBody);
  const result = await recordSubscriptionUpdate({
    shop,
    body: webhookBody,
    store: subscriptionStore,
  });
  if (!result.applied) {
    console.log(
      `--> Skipped ${topic} webhook ${webhookId} for ${shop}: ${result.reason}`
    );
  }
};

export default appSubscriptionsUpdateHandler;
