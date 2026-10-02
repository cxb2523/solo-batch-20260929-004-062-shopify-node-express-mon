import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { navigate } from "raviger";
import { useCallback, useEffect, useState } from "react";

const statusTone = (status) => {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PENDING":
      return "attention";
    case "CANCELLED":
      return "critical";
    default:
      return "info";
  }
};

const formatDate = (value) =>
  value ? new Date(value).toLocaleString() : "N/A";

const BillingPage = () => {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [inTrial, setInTrial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/apps/billing/state");
      const data = await res.json();
      setPlans(data.plans ?? []);
      setSubscription(data.subscription ?? null);
      setInTrial(Boolean(data.inTrial));
    } catch (e) {
      setNotice({
        tone: "critical",
        text: "Failed to load billing state. Please refresh the page.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchPlan = async (planHandle) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/apps/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planHandle }),
      });
      const data = await res.json();
      if (data.confirmationUrl) {
        // Redirect the merchant to Shopify's confirmation screen.
        open(data.confirmationUrl, "_top");
        return;
      }
      setNotice({
        tone: "critical",
        text: `${data.code ? `[${data.code}] ` : ""}${
          data.message ?? "Failed to switch plan"
        }`,
      });
    } catch (e) {
      setNotice({ tone: "critical", text: "Failed to switch plan" });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const cancelPlan = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/apps/billing/cancel", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setNotice({
          tone: "success",
          text: data.message ?? "Subscription cancelled",
        });
      } else {
        setNotice({
          tone: "critical",
          text: `${data.code ? `[${data.code}] ` : ""}${
            data.message ?? "Failed to cancel subscription"
          }`,
        });
      }
    } catch (e) {
      setNotice({ tone: "critical", text: "Failed to cancel subscription" });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Page
      title="Subscription Plans"
      subtitle="Manage the merchant's subscription plan"
      backAction={{ content: "Debug", onAction: () => navigate("/debug") }}
    >
      <Layout>
        {notice && (
          <Layout.Section>
            <Banner
              tone={notice.tone}
              onDismiss={() => setNotice(null)}
              title={notice.text}
            />
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Current subscription
              </Text>
              {loading ? (
                <InlineStack align="center" blockAlign="center" gap="200">
                  <Spinner size="small" />
                  <Text as="span">Syncing with Shopify...</Text>
                </InlineStack>
              ) : subscription ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="headingLg">
                      {subscription.planName}
                    </Text>
                    <Badge tone={statusTone(subscription.status)}>
                      {subscription.status}
                    </Badge>
                    {inTrial && <Badge tone="info">Trial</Badge>}
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {subscription.price
                      ? `${subscription.price.currencyCode} ${subscription.price.amount} / 30 days`
                      : ""}
                    {subscription.trialDays
                      ? ` · ${subscription.trialDays} trial days`
                      : ""}
                  </Text>
                  <Text as="p" tone="subdued">
                    Subscription ID: {subscription.subscriptionId}
                  </Text>
                  <Text as="p" tone="subdued">
                    Created: {formatDate(subscription.sourceCreatedAt)} · Last
                    updated: {formatDate(subscription.sourceUpdatedAt)}
                  </Text>
                  {subscription.status === "PENDING" && (
                    <Banner tone="info" title="Subscription pending">
                      The merchant has not confirmed this subscription yet. It
                      cannot be cancelled until it is accepted or declined.
                    </Banner>
                  )}
                  {subscription.status === "ACTIVE" && (
                    <InlineStack align="end">
                      <Button
                        tone="critical"
                        variant="primary"
                        loading={busy}
                        onClick={cancelPlan}
                      >
                        Cancel subscription
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              ) : (
                <Text as="p">No active subscription. Pick a plan below.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {plans.map((plan) => {
          const isCurrent =
            subscription &&
            ["ACTIVE", "PENDING"].includes(subscription.status) &&
            subscription.plan === plan.handle;
          return (
            <Layout.Section variant="oneHalf" key={plan.handle}>
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      {plan.name}
                    </Text>
                    {isCurrent && <Badge tone="success">Current plan</Badge>}
                  </InlineStack>
                  <Text as="p">
                    {plan.currencyCode} {plan.price} / 30 days
                  </Text>
                  <Text as="p" tone="subdued">
                    Includes a {plan.trialDays}-day free trial.
                  </Text>
                  <Box minHeight="1px" />
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      disabled={isCurrent || loading}
                      loading={busy}
                      onClick={() => switchPlan(plan.handle)}
                    >
                      {subscription ? "Switch to this plan" : "Subscribe"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          );
        })}
      </Layout>
    </Page>
  );
};

export default BillingPage;
