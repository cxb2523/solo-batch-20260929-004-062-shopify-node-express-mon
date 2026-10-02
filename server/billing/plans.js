/**
 * Available subscription plans for the app.
 * `handle` is the internal identifier used by the client and stored in MongoDB.
 */
const PLANS = [
  {
    handle: "basic",
    name: "Basic",
    price: 10.25,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
  },
  {
    handle: "pro",
    name: "Pro",
    price: 25.5,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
  },
];

const getPlan = (handle) =>
  PLANS.find((plan) => plan.handle === handle) ?? null;

const planHandleForName = (name) =>
  PLANS.find((plan) => plan.name === name)?.handle ?? "unknown";

export { PLANS, getPlan, planHandleForName };
