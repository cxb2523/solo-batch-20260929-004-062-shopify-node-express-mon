import SubscriptionModel from "../../utils/models/SubscriptionModel.js";

/**
 * Strips Mongoose metadata so records look identical to the in-memory store.
 * @param {import("mongoose").Document | null} doc
 */
const toPlain = (doc) => {
  if (!doc) {
    return null;
  }
  const { _id, ...rest } =
    typeof doc.toObject === "function" ? doc.toObject() : doc;
  return rest;
};

/**
 * Mongoose-backed subscription store. Method contract matches
 * {@link import("./memoryStore.js").default}.
 */
const createMongoStore = () => ({
  async insertIfAbsent(shop, data) {
    try {
      const doc = await SubscriptionModel.create({ ...data, shop });
      return { record: toPlain(doc), duplicate: false };
    } catch (error) {
      // Duplicate key (E11000) on (shop, subscriptionId) -> redelivery.
      if (error?.code === 11000) {
        const existing = await SubscriptionModel.findOne({
          shop,
          subscriptionId: data.subscriptionId,
        });
        return { record: toPlain(existing), duplicate: true };
      }
      throw error;
    }
  },

  async upsertIfNewer(shop, data, incomingUpdatedAt) {
    const existing = await SubscriptionModel.findOne({
      shop,
      subscriptionId: data.subscriptionId,
    });

    if (!existing) {
      try {
        const created = await SubscriptionModel.create({
          ...data,
          shop,
          updatedAt: data.updatedAt ?? incomingUpdatedAt ?? null,
        });
        return { record: toPlain(created), duplicate: false, stale: false };
      } catch (error) {
        if (error?.code === 11000) {
          const raced = await SubscriptionModel.findOne({
            shop,
            subscriptionId: data.subscriptionId,
          });
          return { record: toPlain(raced), duplicate: true, stale: false };
        }
        throw error;
      }
    }

    const storedTime = existing.updatedAt
      ? new Date(existing.updatedAt).getTime()
      : 0;
    const incomingTime = incomingUpdatedAt
      ? new Date(incomingUpdatedAt).getTime()
      : 0;

    if (incomingTime < storedTime) {
      return { record: toPlain(existing), duplicate: false, stale: true };
    }
    if (incomingTime === storedTime) {
      return { record: toPlain(existing), duplicate: true, stale: false };
    }

    existing.set({
      ...data,
      updatedAt: incomingUpdatedAt ?? existing.updatedAt,
    });
    const updated = await existing.save();
    return { record: toPlain(updated), duplicate: false, stale: false };
  },

  async updateBySubscriptionId(shop, subscriptionId, patch) {
    const doc = await SubscriptionModel.findOneAndUpdate(
      { shop, subscriptionId },
      { $set: patch },
      { new: true }
    );
    return toPlain(doc);
  },

  async findBySubscriptionId(shop, subscriptionId) {
    return toPlain(await SubscriptionModel.findOne({ shop, subscriptionId }));
  },

  async findLive(shop) {
    const docs = await SubscriptionModel.find({
      shop,
      status: { $in: ["PENDING", "ACTIVE"] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(1);
    return toPlain(docs[0] ?? null);
  },

  async listForShop(shop) {
    const docs = await SubscriptionModel.find({ shop });
    return docs.map(toPlain);
  },
});

export default createMongoStore;
