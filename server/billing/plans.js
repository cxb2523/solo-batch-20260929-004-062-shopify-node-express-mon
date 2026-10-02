/**
 * Subscription plans exposed by the app. Prices are always decimals and are
 * charged every 30 days. `trialDays` is optional and maps to the GraphQL
 * `trialDays` argument of appSubscriptionCreate.
 */
const PLANS = [
  {
    handle: "starter",
    name: "Starter Plan",
    price: 10.25,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 0,
  },
  {
    handle: "growth",
    name: "Growth Plan",
    price: 29.0,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
  },
  {
    handle: "scale",
    name: "Scale Plan",
    price: 79.5,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 14,
  },
];

/**
 * @param {string} handle
 * @returns {(typeof PLANS)[number] | undefined}
 */
const getPlan = (handle) => PLANS.find((plan) => plan.handle === handle);

/**
 * Returns the matching plan for an app subscription name. GraphQL returns the
 * subscription `name` (not the handle), so webhooks and live reconciliation
 * resolve the plan this way.
 * @param {string} [name]
 */
const findPlanByName = (name) => PLANS.find((plan) => plan.name === name);

/**
 * @param {(typeof PLANS)[number]} plan
 */
const toPublicPlan = (plan) => ({
  handle: plan.handle,
  name: plan.name,
  price: plan.price,
  currencyCode: plan.currencyCode,
  interval: plan.interval,
  trialDays: plan.trialDays,
});

const listPublicPlans = () => PLANS.map(toPublicPlan);

export { PLANS, getPlan, findPlanByName, toPublicPlan, listPublicPlans };
