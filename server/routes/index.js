import { Router } from "express";
import clientProvider from "../../utils/clientProvider.js";

const userRoutes = Router();

/**
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
userRoutes.get("/", (req, res) => {
  try {
    const sendData = { text: "This is coming from /api/apps/ route." };
    return res.status(200).json(sendData);
  } catch (e) {
    console.error(e);
    return res.status(400).send({ error: true });
  }
});

/**
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
userRoutes.post("/", (req, res) => {
  try {
    return res.status(200).json(req.body);
  } catch (e) {
    console.error(e);
    return res.status(400).send({ error: true });
  }
});

/**
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
userRoutes.get("/debug/gql", async (req, res) => {
  try {
    //false for offline session, true for online session
    const { client } = await clientProvider.offline.graphqlClient({
      shop: res.locals.user_session.shop,
    });

    const shop = await client.request(/* GraphQL */ `
      {
        shop {
          name
        }
      }
    `);

    return res.status(200).json({ text: shop.data.shop.name });
  } catch (e) {
    console.error(e);
    return res.status(400).send({ error: true, text: "GQL Query broke" });
  }
});

/**
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
userRoutes.get("/debug/activeWebhooks", async (req, res) => {
  try {
    const { client } = await clientProvider.offline.graphqlClient({
      shop: res.locals.user_session.shop,
    });
    const activeWebhooks = await client.request(/* GraphQL */ `
      {
        webhookSubscriptions(first: 25) {
          edges {
            node {
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `);
    return res.status(200).json(activeWebhooks);
  } catch (e) {
    console.error(e);
    return res.status(400).send({ error: true });
  }
});

export default userRoutes;
