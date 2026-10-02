import mongoose from "mongoose";

/**
 * App subscription records synced from APP_SUBSCRIPTIONS_UPDATE webhooks and
 * the billing actions (appSubscriptionCreate / appSubscriptionCancel).
 *
 * The unique (shop, subscriptionId) index guarantees a redelivered webhook
 * can never insert a second record for the same subscription.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    planHandle: { type: String, default: null },
    planName: { type: String, default: null },
    status: { type: String, required: true },
    price: { type: Number, default: null },
    currencyCode: { type: String, default: null },
    interval: { type: String, default: null },
    test: { type: Boolean, default: true },
    trialDays: { type: Number, default: null },
    confirmationUrl: { type: String, default: null },
    createdAt: { type: String, default: null },
    updatedAt: { type: String, default: null },
    cancelledAt: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

subscriptionSchema.index(
  { shop: 1, subscriptionId: 1 },
  { unique: true, name: "uniq_shop_subscription" }
);
subscriptionSchema.index({ shop: 1, status: 1 });

const SubscriptionModel = mongoose.model(
  "App_Subscription",
  subscriptionSchema
);

export default SubscriptionModel;
