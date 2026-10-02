import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { navigate } from "raviger";
import { useCallback, useEffect, useState } from "react";

const STATUS_TONE = {
  ACTIVE: "success",
  PENDING: "caution",
  DECLINED: "critical",
  EXPIRED: "info",
  FROZEN: "warning",
  CANCELLED: "critical",
};

const ERROR_MESSAGES = {
  INVALID_PLAN: "That plan could not be found. Refresh the page and retry.",
  PENDING_SUBSCRIPTION_EXISTS:
    "You already have a subscription waiting for approval. Use the approval link or cancel it before switching plans.",
  ACTIVE_SUBSCRIPTION_CONFLICT:
    "Cancel your current plan before subscribing to another plan.",
  NO_ACTIVE_SUBSCRIPTION:
    "There is no active or pending subscription to cancel.",
  SUBSCRIPTION_NOT_FOUND:
    "The subscription to cancel could not be found. It may have already ended.",
  GRAPHQL_USER_ERROR:
    "Shopify rejected the billing request. Nothing was changed; please try again.",
  GRAPHQL_REQUEST_FAILED:
    "The billing request to Shopify failed. Local state was rolled back; please try again.",
};

const formatPrice = (subscription) =>
  subscription?.price != null
    ? `${subscription.currencyCode ?? "USD"} ${Number(
        subscription.price
      ).toFixed(2)}`
    : "—";

const formatDate = (value) => (value ? new Date(value).toLocaleString() : "—");

const BillingAPI = () => {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loadingState, setLoadingState] = useState(true);
  const [actionPlan, setActionPlan] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [corrections, setCorrections] = useState(0);

  const refresh = useCallback(async () => {
    setLoadingState(true);
    try {
      const [plansRes, currentRes] = await Promise.all([
        fetch("/api/apps/billing/plans"),
        fetch("/api/apps/billing/current"),
      ]);

      if (plansRes.ok) {
        const plansData = await plansRes.json();
        setPlans(plansData.plans ?? []);
      }

      const currentData = await currentRes.json();
      if (!currentRes.ok) {
        setError({
          code: currentData.error ?? "LOAD_FAILED",
          message: currentData.message ?? "Could not load the current plan.",
        });
      } else {
        setSubscription(currentData.subscription ?? null);
        setCorrections((currentData.corrections ?? []).length);
        setError(null);
      }
    } catch (requestError) {
      setError({
        code: "NETWORK_ERROR",
        message: "Could not reach the billing API.",
      });
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = async (plan, cancelActive = false) => {
    setActionPlan(plan.handle);
    setNotice(null);
    setError(null);

    try {
      const res = await fetch("/api/apps/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planHandle: plan.handle,
          cancelActive,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError({
          code: data.error,
          message: ERROR_MESSAGES[data.error] ?? data.message,
          details: data.details ?? null,
        });
        return;
      }

      setSubscription(data.subscription ?? null);
      setNotice({
        tone: "caution",
        title: data.switched ? "Plan switch initiated" : "Approval required",
        message: data.switched
          ? `Your previous plan was cancelled. Redirecting you to approve the ${plan.name}.`
          : `Redirecting you to approve the ${plan.name}. The page will sync once Shopify confirms it.`,
      });
      open(data.confirmationUrl, "_top");
    } catch (requestError) {
      setError({
        code: "NETWORK_ERROR",
        message: ERROR_MESSAGES.GRAPHQL_REQUEST_FAILED,
      });
    } finally {
      setActionPlan(null);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    setCancelOpen(false);
    setNotice(null);
    setError(null);

    try {
      const res = await fetch("/api/apps/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          subscription?.subscriptionId
            ? { subscriptionId: subscription.subscriptionId }
            : {}
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        setError({
          code: data.error,
          message: ERROR_MESSAGES[data.error] ?? data.message,
          details: data.details ?? null,
        });
        return;
      }

      setSubscription(data.subscription ?? null);
      setNotice({
        tone: "success",
        title: "Subscription cancelled",
        message: "Your subscription has been cancelled successfully.",
      });
    } catch (requestError) {
      setError({
        code: "NETWORK_ERROR",
        message: ERROR_MESSAGES.GRAPHQL_REQUEST_FAILED,
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Page
      title="Subscription Plans"
      subtitle="Manage your app subscription"
      backAction={{ content: "Debug", onAction: () => navigate("/debug") }}
      primaryAction={{
        content: "Refresh",
        onAction: refresh,
        loading: loadingState,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="300">
            {notice && (
              <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    {notice.title}
                  </Text>
                  <Text as="p">{notice.message}</Text>
                  {notice.details?.confirmationUrl && (
                    <Button
                      onClick={() =>
                        open(notice.details.confirmationUrl, "_top")
                      }
                    >
                      Open approval link
                    </Button>
                  )}
                </BlockStack>
              </Banner>
            )}

            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    {error.message}
                  </Text>
                  {error.code && (
                    <Text as="p" variant="bodySm">
                      Error code: {error.code}
                    </Text>
                  )}
                  {error?.details?.confirmationUrl && (
                    <Button
                      onClick={() =>
                        open(error.details.confirmationUrl, "_top")
                      }
                    >
                      Open pending approval link
                    </Button>
                  )}
                </BlockStack>
              </Banner>
            )}

            {corrections > 0 && !loadingState && (
              <Banner tone="info" onDismiss={() => setCorrections(0)}>
                Local state was corrected from Shopify on this load.
              </Banner>
            )}

            <CurrentSubscriptionCard
              loading={loadingState}
              subscription={subscription}
              cancelling={cancelling}
              onCancel={() => setCancelOpen(true)}
            />
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          {loadingState ? (
            <Card>
              <InlineStack align="center" blockAlign="center">
                <Spinner accessibilityLabel="Loading plans" size="large" />
              </InlineStack>
            </Card>
          ) : (
            <BlockStack gap="300">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.handle}
                  plan={plan}
                  current={subscription}
                  busy={actionPlan === plan.handle}
                  onSubscribe={() =>
                    subscribe(plan, subscription?.status === "ACTIVE")
                  }
                />
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel subscription?"
        primaryAction={{
          content: "Cancel subscription",
          destructive: true,
          loading: cancelling,
          onAction: cancel,
        }}
        secondaryActions={[
          {
            content: "Keep plan",
            onAction: () => setCancelOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            You are about to cancel{" "}
            <Text fontWeight="bold">
              {subscription?.planName ?? "your plan"}
            </Text>
            . This takes effect immediately and cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

const CurrentSubscriptionCard = ({
  loading,
  subscription,
  cancelling,
  onCancel,
}) => {
  const isLive =
    subscription?.status === "ACTIVE" || subscription?.status === "PENDING";

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Current subscription
          </Text>
          {!loading && subscription && (
            <Badge tone={STATUS_TONE[subscription.status] ?? "info"}>
              {subscription.status}
            </Badge>
          )}
        </InlineStack>

        {loading ? (
          <InlineStack align="center">
            <Spinner accessibilityLabel="Loading subscription" />
          </InlineStack>
        ) : subscription ? (
          <BlockStack gap="100">
            <Text as="p" variant="bodyLg">
              {subscription.planName ?? "Unknown plan"}
            </Text>
            <Text as="p" variant="bodySm">
              {formatPrice(subscription)} /{" "}
              {subscription.interval === "EVERY_30_DAYS"
                ? "every 30 days"
                : (subscription.interval ?? "—")}
              {subscription.trialDays > 0
                ? ` · ${subscription.trialDays}-day trial`
                : ""}
              {subscription.test ? " · test charge" : ""}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Started {formatDate(subscription.createdAt)} · Updated{" "}
              {formatDate(subscription.updatedAt)}
              {subscription.cancelledAt
                ? ` · Cancelled ${formatDate(subscription.cancelledAt)}`
                : ""}
            </Text>

            {subscription.status === "PENDING" &&
              subscription.confirmationUrl && (
                <Banner tone="caution">
                  This subscription is waiting for your approval.
                  <div style={{ marginTop: "8px" }}>
                    <Button
                      onClick={() => open(subscription.confirmationUrl, "_top")}
                    >
                      Complete approval
                    </Button>
                  </div>
                </Banner>
              )}

            {isLive && (
              <InlineStack align="end">
                <Button
                  tone="critical"
                  variant="primary"
                  loading={cancelling}
                  onClick={onCancel}
                >
                  Cancel subscription
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        ) : (
          <Text as="p" tone="subdued">
            You have no active subscription. Pick a plan to get started.
          </Text>
        )}
      </BlockStack>
    </Card>
  );
};

const PlanCard = ({ plan, current, busy, onSubscribe }) => {
  const isCurrentPlan =
    current?.status === "ACTIVE" &&
    (current.planHandle === plan.handle || current.planName === plan.name);

  const hasLiveSubscription =
    current?.status === "ACTIVE" || current?.status === "PENDING";

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {plan.name}
          </Text>
          <Text as="p" variant="bodyLg" fontWeight="bold">
            {plan.currencyCode} {plan.price.toFixed(2)}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Billed every 30 days
          {plan.trialDays > 0 ? ` · ${plan.trialDays}-day free trial` : ""}
        </Text>
        <InlineStack align="end">
          {isCurrentPlan ? (
            <Button disabled>Current plan</Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={onSubscribe}>
              {hasLiveSubscription ? "Switch to this plan" : "Choose plan"}
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
};

export default BillingAPI;
