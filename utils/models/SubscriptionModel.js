import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true },
    subscriptionId: { type: String, required: true },
    plan: { type: String, required: true },
    planName: { type: String, required: true },
    status: { type: String, required: true },
    test: { type: Boolean, default: true },
    trialDays: { type: Number, default: 0 },
    price: {
      amount: { type: Number },
      currencyCode: { type: String },
    },
    sourceCreatedAt: { type: Date },
    sourceUpdatedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ shop: 1, subscriptionId: 1 }, { unique: true });

const SubscriptionModel = mongoose.model(
  "App_Subscriptions",
  SubscriptionSchema
);

export default SubscriptionModel;
