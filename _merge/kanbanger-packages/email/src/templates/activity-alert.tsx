import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface ActivityAlertEmailProps {
  userName: string;
  activityType: string;
  activityDescription: string;
  timestamp: string;
  appName?: string;
  dashboardUrl?: string;
}

export function ActivityAlertEmail({
  userName,
  activityType,
  activityDescription,
  timestamp,
  appName = "Your App",
  dashboardUrl = "https://example.com/dashboard",
}: ActivityAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {activityType}: {activityDescription}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Activity Alert</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            We detected new activity on your account:
          </Text>
          <Section style={activityBox}>
            <Text style={activityTitle}>{activityType}</Text>
            <Text style={activityDesc}>{activityDescription}</Text>
            <Text style={activityTime}>{timestamp}</Text>
          </Section>
          <Section style={buttonContainer}>
            <Button style={button} href={dashboardUrl}>
              View Activity
            </Button>
          </Section>
          <Text style={text}>
            If this wasn&apos;t you, please secure your account immediately.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            You received this because you have activity alerts enabled.{" "}
            <Link href={`${dashboardUrl}/settings`} style={link}>
              Manage preferences
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  marginBottom: "64px",
  borderRadius: "5px",
  maxWidth: "465px",
};

const h1 = {
  color: "#1d1c1d",
  fontSize: "24px",
  fontWeight: "700",
  margin: "30px 0",
  padding: "0",
  lineHeight: "42px",
};

const text = {
  color: "#3c4149",
  fontSize: "14px",
  lineHeight: "24px",
};

const activityBox = {
  background: "#fff8e6",
  border: "1px solid #ffd666",
  borderRadius: "4px",
  margin: "24px 0",
  padding: "16px",
};

const activityTitle = {
  color: "#1d1c1d",
  fontSize: "16px",
  fontWeight: "600",
  margin: "0 0 8px 0",
};

const activityDesc = {
  color: "#3c4149",
  fontSize: "14px",
  margin: "0 0 8px 0",
};

const activityTime = {
  color: "#8898aa",
  fontSize: "12px",
  margin: "0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#000000",
  borderRadius: "5px",
  color: "#fff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
};

const link = {
  color: "#556cd6",
  textDecoration: "underline",
};

export default ActivityAlertEmail;
