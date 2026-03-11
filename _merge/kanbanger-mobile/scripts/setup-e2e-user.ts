#!/usr/bin/env npx tsx
/**
 * Creates a test user for Maestro E2E tests using Clerk's Backend API.
 * 
 * Usage:
 *   cd apps/mobile
 *   pnpm e2e:setup-user
 */

import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_EMAIL = "e2e-test+clerk_test@tasks.gmac.io";

function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      let value = valueParts.join("=");
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}

async function main() {
  const webEnvPath = path.join(__dirname, "../../web/.env.local");
  const mobileEnvPath = path.join(__dirname, "../.env.local");
  
  const webEnv = loadEnvFile(webEnvPath);
  const clerkSecretKey = process.env.CLERK_SECRET_KEY || webEnv.CLERK_SECRET_KEY;
  
  if (!clerkSecretKey) {
    console.error("Error: CLERK_SECRET_KEY not found");
    console.error("Set it via env var or ensure apps/web/.env.local exists");
    process.exit(1);
  }

  const password = process.env.E2E_TEST_PASSWORD || randomBytes(16).toString("base64url");

  console.log("Creating E2E test user...");
  console.log(`  Email: ${TEST_EMAIL}`);

  try {
    const response = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: [TEST_EMAIL],
        password: password,
        skip_password_checks: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.errors?.[0]?.code === "form_identifier_exists") {
        console.log("User already exists. Resetting password...");
        
        const listResponse = await fetch(
          `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_EMAIL)}`,
          { headers: { "Authorization": `Bearer ${clerkSecretKey}` } }
        );
        const users = await listResponse.json();
        const userId = users.data?.[0]?.id || users[0]?.id;
        
        if (userId) {
          const updateResponse = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${clerkSecretKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ password, skip_password_checks: true }),
          });
          
          if (!updateResponse.ok) {
            console.error("Failed to update:", await updateResponse.json());
            process.exit(1);
          }
        }
      } else {
        console.error("Clerk API error:", JSON.stringify(data, null, 2));
        console.error("\nIf email auth isn't enabled, create the user manually:");
        console.error(`  1. Go to beta.tasks.gmac.io and sign up with: ${TEST_EMAIL}`);
        console.error("  2. Use verification code: 424242");
        console.error(`  3. Set password to: ${password}`);
        console.error("\nThen add to apps/mobile/.env.local:");
        console.error(`  MAESTRO_TEST_EMAIL=${TEST_EMAIL}`);
        console.error(`  MAESTRO_TEST_PASSWORD=${password}`);
        process.exit(1);
      }
    }

    console.log("\n✓ Test user ready!");
    console.log("\nCredentials:");
    console.log(`  MAESTRO_TEST_EMAIL=${TEST_EMAIL}`);
    console.log(`  MAESTRO_TEST_PASSWORD=${password}`);

    const envContent = `MAESTRO_TEST_EMAIL=${TEST_EMAIL}\nMAESTRO_TEST_PASSWORD=${password}\n`;
    
    let existingContent = "";
    if (fs.existsSync(mobileEnvPath)) {
      existingContent = fs.readFileSync(mobileEnvPath, "utf-8");
    }
    
    if (!existingContent.includes("MAESTRO_TEST_EMAIL")) {
      fs.writeFileSync(mobileEnvPath, existingContent + envContent);
      console.log(`\n✓ Saved to apps/mobile/.env.local`);
    } else {
      console.log(`\nNote: apps/mobile/.env.local already has MAESTRO_TEST_EMAIL`);
    }

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
