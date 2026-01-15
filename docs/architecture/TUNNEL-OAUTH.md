# Tunnel & OAuth Configuration

This document describes Bob's tunnel and OAuth callback system for authenticating AI agents with external providers.

## Overview

Some AI providers (OpenAI, Google, Anthropic) use OAuth with localhost callbacks. When Bob runs on a remote server, these callbacks fail because the browser cannot reach `localhost` on the server.

Bob solves this with an optional ngrok tunnel that:
1. Exposes the Bob backend to a public URL
2. Receives OAuth callbacks at that URL
3. Exchanges authorization codes for tokens server-side
4. Stores tokens encrypted for later use

## Architecture

```
Browser                  ngrok               Bob Backend
   |                       |                      |
   |--- OAuth redirect --->|                      |
   |                       |--- callback -------->|
   |                       |                      |--- token exchange --->
   |<-- success page ------|<---------------------|<--- tokens ----------
```

## Setup

### 1. Install ngrok SDK (Optional)

```bash
cd backend
npm install @ngrok/ngrok
```

The ngrok SDK is optional. If not installed, tunnel features return a helpful error message.

### 2. Configure ngrok Authentication

Set the `NGROK_AUTHTOKEN` environment variable:

```bash
export NGROK_AUTHTOKEN=your-authtoken-here
```

Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken

### 3. Configure Token Encryption

Set a strong encryption key:

```bash
export BOB_TOKEN_ENCRYPTION_KEY=your-secret-encryption-key
```

If not set, Bob derives a key from machine identity (hostname + username). This works for single-machine deployments but is not portable.

## API Endpoints

### Tunnel Management

```
GET  /api/system/tunnel/status
POST /api/system/tunnel/start
POST /api/system/tunnel/stop
GET  /api/system/tunnel/callback-url?path=/api/oauth/callback/openai
```

### OAuth Flow

```
POST /api/oauth/register
GET  /api/oauth/callback/:provider
GET  /api/oauth/status/:state
POST /api/oauth/exchange/:state
GET  /api/oauth/providers
```

## Production OAuth Requirements

### The Problem with Dynamic URLs

OAuth providers require pre-registered callback URLs. When using ngrok's free tier:
- URLs change on every restart (e.g., `https://abc123.ngrok.io`)
- You cannot pre-register these URLs with OAuth providers
- OAuth flows fail with "redirect_uri mismatch" errors

### Solution: Custom ngrok Domain

For production use, you need a stable ngrok domain:

1. **ngrok Pro/Business Plan**: Get a reserved domain like `bob.yourdomain.ngrok.io`
2. **Self-hosted ngrok**: Run your own ngrok server with a fixed domain
3. **Alternative**: Use Cloudflare Tunnel or similar with a stable domain

### Configuring a Custom Domain

```bash
# Start tunnel with custom domain
POST /api/system/tunnel/start
{
  "domain": "bob.yourdomain.ngrok.io"
}
```

Or via environment:
```bash
export NGROK_DOMAIN=bob.yourdomain.ngrok.io
```

### Provider-Specific Setup

#### OpenAI

1. Register your app at https://platform.openai.com/settings/organization/apps
2. Add callback URL: `https://your-domain.ngrok.io/api/oauth/callback/openai`
3. Set environment variables:
   ```bash
   export OPENAI_CLIENT_ID=your-client-id
   export OPENAI_CLIENT_SECRET=your-client-secret
   ```

#### Google (Gemini)

1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials
2. Add authorized redirect URI: `https://your-domain.ngrok.io/api/oauth/callback/google`
3. Set environment variables:
   ```bash
   export GOOGLE_CLIENT_ID=your-client-id
   export GOOGLE_CLIENT_SECRET=your-client-secret
   ```

#### Anthropic

1. Register at https://console.anthropic.com/settings/oauth
2. Add callback URL: `https://your-domain.ngrok.io/api/oauth/callback/anthropic`
3. Set environment variables:
   ```bash
   export ANTHROPIC_CLIENT_ID=your-client-id
   export ANTHROPIC_CLIENT_SECRET=your-client-secret
   ```

## Desktop Mode (No Tunnel Needed)

In desktop mode, agents handle OAuth callbacks locally:

| Provider  | Local Callback Port |
|-----------|---------------------|
| OpenAI    | 1455                |
| Google    | 36742               |
| Anthropic | (varies)            |

Bob's `opencode auth login` command handles these flows automatically without needing the tunnel.

## Security Considerations

### Token Storage

- Tokens are encrypted with AES-256-GCM before database storage
- Each token has a unique IV (initialization vector)
- Authentication tags prevent tampering
- Keys derived via scrypt with appropriate cost factors

### Tunnel Security

- ngrok provides TLS termination
- Consider enabling ngrok's IP restrictions for production
- Monitor tunnel usage via ngrok dashboard
- Rotate `NGROK_AUTHTOKEN` periodically

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NGROK_AUTHTOKEN` | For tunnel | ngrok authentication token |
| `NGROK_DOMAIN` | For prod OAuth | Custom ngrok domain |
| `BOB_TOKEN_ENCRYPTION_KEY` | Recommended | Token encryption key |
| `OPENAI_CLIENT_ID` | For OpenAI OAuth | OpenAI app client ID |
| `OPENAI_CLIENT_SECRET` | For OpenAI OAuth | OpenAI app client secret |
| `GOOGLE_CLIENT_ID` | For Google OAuth | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | Google OAuth client secret |
| `ANTHROPIC_CLIENT_ID` | For Anthropic OAuth | Anthropic OAuth client ID |
| `ANTHROPIC_CLIENT_SECRET` | For Anthropic OAuth | Anthropic OAuth client secret |

## Troubleshooting

### "ngrok SDK not available"

Install the optional dependency:
```bash
npm install @ngrok/ngrok
```

### "Failed to start tunnel"

1. Check `NGROK_AUTHTOKEN` is set correctly
2. Verify your ngrok account has available tunnels
3. Check ngrok dashboard for rate limits

### "redirect_uri mismatch"

1. Ensure your tunnel domain matches the registered callback URL
2. For production, use a custom ngrok domain
3. Wait for DNS propagation after domain changes

### "Failed to decrypt token"

1. `BOB_TOKEN_ENCRYPTION_KEY` may have changed
2. Tokens encrypted with old key are unrecoverable
3. Re-authenticate with the provider
