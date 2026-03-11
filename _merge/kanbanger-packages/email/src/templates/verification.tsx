import {
  Body,
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

interface VerificationEmailProps {
  userName: string;
  verificationCode: string;
  appName?: string;
  expiresInMinutes?: number;
}

export function VerificationEmail({
  userName,
  verificationCode,
  appName = "Your App",
  expiresInMinutes = 10,
}: VerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your verification code: {verificationCode}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Verify your email</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            Enter this verification code to complete your sign in:
          </Text>
          <Section style={codeContainer}>
            <Text style={code}>{verificationCode}</Text>
          </Section>
          <Text style={text}>
            This code expires in {expiresInMinutes} minutes.
          </Text>
          <Text style={text}>
            If you didn&apos;t request this code, you can safely ignore this
            email.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            This email was sent by{" "}
            <Link href="#" style={link}>
              {appName}
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

const codeContainer = {
  background: "#f4f4f5",
  borderRadius: "4px",
  margin: "24px 0",
  padding: "24px",
  textAlign: "center" as const,
};

const code = {
  color: "#000",
  display: "inline-block",
  fontSize: "32px",
  fontWeight: "700",
  letterSpacing: "6px",
  lineHeight: "40px",
  paddingBottom: "0",
  paddingTop: "0",
  margin: "0",
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

export default VerificationEmail;
