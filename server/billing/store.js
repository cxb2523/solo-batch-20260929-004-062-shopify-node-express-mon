import SubscriptionModel from "../../utils/models/SubscriptionModel.js";

/**
 * Store contract used by the billing service:
 *   findBySubscriptionId(shop, subscriptionId) -> record | null
 *   findCurrent(shop) -> latest ACTIVE/PENDING record | null
 *   upsert(shop, record) -> persisted record (keyed by shop + subscriptionId)
 */
const subscriptionStore = {
  async findBySubscriptionId(shop, subscriptionId) {
    return SubscriptionModel.findOne({ shop, subscriptionId }).lean();
  },

  async findCurrent(shop) {
    return SubscriptionModel.findOne({
      shop,
      status: { $in: ["ACTIVE", "PENDING"] },
    })
      .sort({ updatedAt: -1 })
      .lean();
  },

  async upsert(shop, record) {
    const { subscriptionId, ...fields } = record;
    return SubscriptionModel.findOneAndUpdate(
      { shop, subscriptionId },
      { $set: { shop, subscriptionId, ...fields } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  },
};

/**
 * In-memory implementation of the store contract, used by tests.
 */
const createMemoryStore = () => {
  const records = new Map();
  const key = (shop, subscriptionId) => `${shop}::${subscriptionId}`;

  return {
    async findBySubscriptionId(shop, subscriptionId) {
      return records.get(key(shop, subscriptionId)) ?? null;
    },

    async findCurrent(shop) {
      const current = [...records.values()].filter(
        (record) =>
          record.shop === shop && ["ACTIVE", "PENDING"].includes(record.status)
      );
      return (
        current.sort(
          (a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0)
        )[0] ?? null
      );
    },

    async upsert(shop, record) {
      const existing = records.get(key(shop, record.subscriptionId)) ?? {};
      const merged = {
        ...existing,
        shop,
        ...record,
        updatedAt: new Date(),
      };
      records.set(key(shop, record.subscriptionId), merged);
      return merged;
    },

    async all() {
      return [...records.values()];
    },
  };
};

export { subscriptionStore, createMemoryStore };
