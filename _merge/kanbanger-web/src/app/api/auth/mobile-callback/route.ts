import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionToken = searchParams.get("session_token");
  const error = searchParams.get("error");
  const redirectScheme = searchParams.get("redirect");

  if (redirectScheme) {
    const redirectUrl = new URL(redirectScheme);
    if (sessionToken) {
      redirectUrl.searchParams.set("session_token", sessionToken);
    }
    if (error) {
      redirectUrl.searchParams.set("error", error);
    }
    return NextResponse.redirect(redirectUrl.toString());
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Authentication</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #f9fafb;
            color: #111827;
          }
          .container {
            text-align: center;
            padding: 24px;
          }
          h1 { font-size: 24px; margin-bottom: 8px; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          ${error 
            ? `<h1>Authentication Failed</h1><p>${error}</p>` 
            : sessionToken 
              ? `<h1>Authentication Successful</h1><p>You can close this window and return to the app.</p>`
              : `<h1>Authentication Error</h1><p>No session token received.</p>`
          }
        </div>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
