import { Router } from "express";
import clientProvider from "../../utils/clientProvider.js";
import {
  cancelSubscription,
  createSubscription,
  syncFromShopify,
} from "../billing/service.js";
import { subscriptionStore } from "../billing/store.js";

const billingRoutes = Router();

const offlineClient = async (shop) =>
  clientProvider.offline.graphqlClient({ shop });

/**
 * Returns the available plans and the shop's current subscription.
 * Local MongoDB state is corrected against Shopify's live
 * `currentAppInstallation` query on every page load.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
billingRoutes.get("/state", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const { client } = await offlineClient(shop);
    const state = await syncFromShopify({
      client,
      shop,
      store: subscriptionStore,
    });
    return res.status(200).json(state);
  } catch (e) {
    console.error(`---> An error occured at /api/apps/billing/state`, e);
    return res
      .status(400)
      .send({ error: true, message: "Failed to load billing state" });
  }
});

/**
 * Creates (or switches to) a subscription plan. Responds with the Shopify
 * confirmation URL the client must redirect the merchant to.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
billingRoutes.post("/subscribe", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const { plan } = req.body ?? {};
    const { client } = await offlineClient(shop);
    const result = await createSubscription({
      client,
      shop,
      store: subscriptionStore,
      planHandle: plan,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/?shop=${shop}`,
    });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error(`---> An error occured at /api/apps/billing/subscribe`, e);
    return res
      .status(400)
      .send({ error: true, message: "Failed to create subscription" });
  }
});

/**
 * Cancels the shop's current subscription.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
billingRoutes.post("/cancel", async (req, res) => {
  try {
    const shop = res.locals.user_session.shop;
    const { client } = await offlineClient(shop);
    const result = await cancelSubscription({
      client,
      shop,
      store: subscriptionStore,
    });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error(`---> An error occured at /api/apps/billing/cancel`, e);
    return res
      .status(400)
      .send({ error: true, message: "Failed to cancel subscription" });
  }
});

export default billingRoutes;
