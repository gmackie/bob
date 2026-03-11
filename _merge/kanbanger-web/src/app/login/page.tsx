"use client";

import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/dashboard";

  const handleEntraLogin = () => {
    // Redirect to Entra ID OAuth
    const params = new URLSearchParams({
      returnUrl,
    });
    window.location.href = `/api/auth/entra?${params.toString()}`;
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-indigo-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-indigo-600 rounded-xl flex items-center justify-center">
              <svg
                className="w-10 h-10 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-gray-400">Sign in to Tasks @ Gmacko</p>
        </div>

        <div className="bg-white/5 rounded-xl border border-white/10 p-8">
          <button
            onClick={handleEntraLogin}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
              <path d="M0 0h10v10H0z" fill="#f25022" />
              <path d="M11 0h10v10H11z" fill="#7fba00" />
              <path d="M0 11h10v10H0z" fill="#00a4ef" />
              <path d="M11 11h10v10H11z" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-transparent text-gray-400">
                Or continue with
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <a
              href={`/api/auth/github?returnUrl=${encodeURIComponent(returnUrl)}`}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white/5 text-white font-medium rounded-lg hover:bg-white/10 transition-colors border border-white/10"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
            <a
              href={`/api/auth/gitea?returnUrl=${encodeURIComponent(returnUrl)}`}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white/5 text-white font-medium rounded-lg hover:bg-white/10 transition-colors border border-white/10"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.901 0C5.32 0 0 5.32 0 11.901c0 6.58 5.32 11.901 11.901 11.901 6.58 0 11.901-5.32 11.901-11.901C23.802 5.32 18.48 0 11.901 0zm5.33 18.28l-.66.66c-.08.08-.19.13-.3.13h-3.24l-1.35-1.35c-.17-.17-.46-.17-.63 0-.08.08-.13.19-.13.31v1.04H8.56v-5.66c0-.25.2-.45.45-.45h2.25c.25 0 .45.2.45.45v2.25l1.35 1.35c.17.17.46.17.63 0l.31-.31c.17-.17.17-.46 0-.63l-1.04-1.04v-.86l2.56-2.56c.08-.08.13-.19.13-.31V8.56h1.35v3.73c0 .12-.05.23-.13.31l-2.25 2.25v.86l1.04 1.04c.17.17.17.46 0 .63l-.31.31c-.17.17-.46.17-.63 0l-.89-.89h-.45l-1.35 1.35c-.08.08-.19.13-.31.13h-.45l.89.89z" />
              </svg>
              Gitea
            </a>
          </div>

          <p className="mt-6 text-center text-sm text-gray-400">
            Sign in with your @gmacko.com Microsoft account
          </p>
        </div>
      </div>
    </main>
  );
}
