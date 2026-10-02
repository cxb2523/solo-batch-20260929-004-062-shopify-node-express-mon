/**
 * Readable error codes returned by the billing routes. Every code is stable so
 * the client can render a helpful message.
 */
export const BILLING_ERRORS = {
  INVALID_PLAN: {
    code: "INVALID_PLAN",
    status: 400,
    message: "The requested plan does not exist.",
  },
  MISSING_SUBSCRIPTION_ID: {
    code: "MISSING_SUBSCRIPTION_ID",
    status: 400,
    message: "A subscription id is required.",
  },
  NO_ACTIVE_SUBSCRIPTION: {
    code: "NO_ACTIVE_SUBSCRIPTION",
    status: 409,
    message: "There is no active or pending subscription to cancel.",
  },
  SUBSCRIPTION_NOT_FOUND: {
    code: "SUBSCRIPTION_NOT_FOUND",
    status: 404,
    message: "The subscription to cancel could not be found.",
  },
  PENDING_SUBSCRIPTION_EXISTS: {
    code: "PENDING_SUBSCRIPTION_EXISTS",
    status: 409,
    message:
      "A subscription is already waiting for approval. Approve or cancel it before switching.",
  },
  ACTIVE_SUBSCRIPTION_CONFLICT: {
    code: "ACTIVE_SUBSCRIPTION_CONFLICT",
    status: 409,
    message:
      "An active subscription exists. Cancel it before subscribing to another plan.",
  },
  GRAPHQL_USER_ERROR: {
    code: "GRAPHQL_USER_ERROR",
    status: 502,
    message: "Shopify rejected the billing request.",
  },
  GRAPHQL_REQUEST_FAILED: {
    code: "GRAPHQL_REQUEST_FAILED",
    status: 502,
    message: "The billing request to Shopify failed. Please try again.",
  },
};

export class BillingError extends Error {
  /**
   * @param {keyof typeof BILLING_ERRORS} key
   * @param {{ details?: any, cause?: Error }} [options]
   */
  constructor(key, { details, cause } = {}) {
    const spec = BILLING_ERRORS[key];
    super(spec.message, { cause });
    this.name = "BillingError";
    this.code = spec.code;
    this.status = spec.status;
    this.details = details;
  }
}

/**
 * Maps a thrown value to a billing error. userErrors from the GraphQL
 * mutation surface as GRAPHQL_USER_ERROR; transport/network failures as
 * GRAPHQL_REQUEST_FAILED.
 * @param {unknown} error
 */
export const toBillingError = (error) => {
  if (error instanceof BillingError) {
    return error;
  }

  const message = error?.message ?? String(error);
  const statusCode = error?.response?.statusCode ?? error?.statusCode;

  // Shopify GraphQL client throws a Response error with `.response` when the
  // HTTP request fails.
  if (error?.response || statusCode) {
    return new BillingError("GRAPHQL_REQUEST_FAILED", {
      details: { message, statusCode },
      cause: error,
    });
  }

  return new BillingError("GRAPHQL_REQUEST_FAILED", {
    details: { message },
    cause: error instanceof Error ? error : undefined,
  });
};
