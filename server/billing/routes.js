import { Router } from "express";
import clientProvider from "../../utils/clientProvider.js";
import { CURRENT_INSTALLATION_QUERY } from "./graphql.js";
import { reconcileWithShopify } from "./reconcile.js";
import { cancelSubscription, createSubscription } from "./service.js";
import createMongoStore from "./mongoStore.js";
import { listPublicPlans } from "./plans.js";
import { toPublicSubscription } from "./normalize.js";

const store = createMongoStore();

const billingRouter = Router();

/**
 * Converts a BillingError (or anything else) into a JSON error response.
 * @param {import('express').Response} res
 * @param {unknown} error
 */
const sendBillingError = (res, error) => {
  if (error?.name === "BillingError") {
    return res.status(error.status).json({
      error: error.code,
      message: error.message,
      details: error.details ?? null,
    });
  }

  console.error("---> Billing route error:", error);
  return res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
};

/**
 * GET /api/apps/billing/plans
 * Lists available subscription plans.
 */
billingRouter.get("/plans", (req, res) => {
  res.status(200).json({ plans: listPublicPlans() });
});

/**
 * GET /api/apps/billing/current
 * Corrects stored state against a live currentAppInstallation query and
 * returns the current subscription (webhooks keep it fresh between loads).
 */
billingRouter.get("/current", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const { client } = await clientProvider.offline.graphqlClient({ shop });

    let response;
    try {
      response = await client.request(CURRENT_INSTALLATION_QUERY);
    } catch (error) {
      console.error("---> Live billing query failed:", error?.message);
      const fallback = await store.findLive(shop);
      return res.status(200).json({
        subscription: toPublicSubscription(fallback),
        correctedFromLive: false,
        corrections: [],
      });
    }

    const report = await reconcileWithShopify({
      store,
      shop,
      graphqlResponse: response,
    });

    return res.status(200).json({
      subscription: toPublicSubscription(report.current),
      correctedFromLive: true,
      corrections: report.corrections,
    });
  } catch (error) {
    return sendBillingError(res, error);
  }
});

/**
 * POST /api/apps/billing/subscribe { planHandle }
 * Calls appSubscriptionCreate and returns the Shopify confirmation URL.
 */
billingRouter.post("/subscribe", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const { planHandle, cancelActive } = req.body ?? {};
    const { client } = await clientProvider.offline.graphqlClient({ shop });

    const returnUrl = `${process.env.SHOPIFY_APP_URL}/debug/billing?shop=${shop}`;

    const result = await createSubscription({
      client,
      store,
      shop,
      planHandle,
      returnUrl,
      cancelActive: cancelActive === true,
    });

    return res.status(200).json({
      confirmationUrl: result.confirmationUrl,
      subscription: toPublicSubscription(result.subscription),
      switched: result.switched === true,
    });
  } catch (error) {
    if (error?.name === "BillingError" && error.details?.confirmationUrl) {
      res.setHeader(
        "X-Billing-Confirmation-Url",
        error.details.confirmationUrl
      );
    }
    return sendBillingError(res, error);
  }
});

/**
 * POST /api/apps/billing/cancel { subscriptionId? }
 * Calls appSubscriptionCancel.
 */
billingRouter.post("/cancel", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const subscriptionId = req.body?.subscriptionId || undefined;
    const { client } = await clientProvider.offline.graphqlClient({ shop });

    const result = await cancelSubscription({
      client,
      store,
      shop,
      subscriptionId,
    });

    return res.status(200).json({
      subscription: toPublicSubscription(result.subscription),
    });
  } catch (error) {
    return sendBillingError(res, error);
  }
});

export default billingRouter;
export { store as billingStore };
