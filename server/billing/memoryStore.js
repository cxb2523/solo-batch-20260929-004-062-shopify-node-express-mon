/**
 * In-memory subscription store. Mirrors the Mongoose-backed store's contract
 * so service/webhook logic can be unit tested without MongoDB.
 */
const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);

const createMemoryStore = () => {
  /** @type {Map<string, any[]>} shop -> records */
  const recordsByShop = new Map();

  const recordsFor = (shop) => {
    if (!recordsByShop.has(shop)) {
      recordsByShop.set(shop, []);
    }
    return recordsByShop.get(shop);
  };

  return {
    /**
     * Idempotent insert keyed on (shop, subscriptionId). Returns
     * `{ record, duplicate: boolean }` and never creates a second record for
     * the same subscription id.
     */
    async insertIfAbsent(shop, data) {
      const records = recordsFor(shop);
      const existing = records.find(
        (record) => record.subscriptionId === data.subscriptionId
      );
      if (existing) {
        return { record: clone(existing), duplicate: true };
      }
      const record = { ...clone(data), shop };
      records.push(record);
      return { record: clone(record), duplicate: false };
    },

    /**
     * Updates a record only when it is missing or when `incomingUpdatedAt` is
     * newer than the stored `updatedAt`. Guards against out-of-order webhook
     * redeliveries. Returns `{ record, duplicate, stale }`.
     */
    async upsertIfNewer(shop, data, incomingUpdatedAt) {
      const records = recordsFor(shop);
      const index = records.findIndex(
        (record) => record.subscriptionId === data.subscriptionId
      );

      if (index === -1) {
        const record = {
          ...clone(data),
          shop,
          updatedAt: data.updatedAt ?? incomingUpdatedAt ?? null,
        };
        records.push(record);
        return { record: clone(record), duplicate: false, stale: false };
      }

      const existing = records[index];
      const storedTime = existing.updatedAt
        ? new Date(existing.updatedAt).getTime()
        : 0;
      const incomingTime = incomingUpdatedAt
        ? new Date(incomingUpdatedAt).getTime()
        : 0;

      if (incomingTime < storedTime) {
        return { record: clone(existing), duplicate: false, stale: true };
      }
      if (incomingTime === storedTime) {
        return { record: clone(existing), duplicate: true, stale: false };
      }

      const updated = {
        ...existing,
        ...clone(data),
        updatedAt: incomingUpdatedAt ?? existing.updatedAt,
      };
      records[index] = updated;
      return { record: clone(updated), duplicate: false, stale: false };
    },

    async updateBySubscriptionId(shop, subscriptionId, patch) {
      const records = recordsFor(shop);
      const index = records.findIndex(
        (record) => record.subscriptionId === subscriptionId
      );
      if (index === -1) {
        return null;
      }
      records[index] = { ...records[index], ...clone(patch) };
      return clone(records[index]);
    },

    async findBySubscriptionId(shop, subscriptionId) {
      const record = recordsFor(shop).find(
        (entry) => entry.subscriptionId === subscriptionId
      );
      return clone(record) ?? null;
    },

    async findLive(shop) {
      const live = recordsFor(shop)
        .filter((record) => ["PENDING", "ACTIVE"].includes(record.status))
        .sort((a, b) => {
          const diff =
            new Date(b.updatedAt ?? 0).getTime() -
            new Date(a.updatedAt ?? 0).getTime();
          if (diff !== 0) return diff;
          return (
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime()
          );
        });
      return clone(live[0]) ?? null;
    },

    async listForShop(shop) {
      return clone(recordsFor(shop));
    },
  };
};

export default createMemoryStore;
