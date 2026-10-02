/**
 * Live query used on page load to correct locally stored state.
 */
export const CURRENT_INSTALLATION_QUERY = /* GraphQL */ `
  query CurrentBillingState {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        createdAt
        updatedAt
        trialDays
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                __typename
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const CREATE_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CreateSubscription(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: $test
      trialDays: $trialDays
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
        status
      }
    }
  }
`;

export const CANCEL_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
    }
  }
`;
