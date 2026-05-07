import { ReactNode } from "react";
import Link from "next/link";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footerText: ReactNode;
  footerLink: string;
  footerLinkText: string;
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footerText,
  footerLink,
  footerLinkText,
}: AuthLayoutProps) {
  return (
    <main className="flex-1 flex items-center justify-center p-6 bg-[#f3f3fd] relative overflow-hidden min-h-screen">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-[#dae2ff] opacity-40 blur-3xl animate-pulse-slow" />
        <div className="absolute -bottom-60 -left-40 w-[600px] h-[600px] rounded-full bg-[#d9e2ff] opacity-30 blur-3xl animate-pulse-slow-delay" />
        <div className="absolute top-1/3 left-1/4 w-[200px] h-[200px] rounded-full bg-[#b2c5ff] opacity-20 blur-2xl animate-float" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-card p-8 backdrop-blur-sm border border-[#e1e2ec]/60 transition-all duration-300 hover:shadow-card-hover">
          {/* Header */}
          <div className="text-center mb-8">
            {/* Brand Logo */}
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#003d9b] to-[#0052cc] mb-5 shadow-lg shadow-[#003d9b]/25 transition-transform duration-300 hover:scale-105">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </div>

            <h1 className="text-[28px] font-semibold text-[#191b23] leading-[1.3] tracking-[-0.01em] mb-2">
              {title}
            </h1>
            <p className="text-sm text-[#434654] leading-[1.5]">{subtitle}</p>
          </div>

          {children}

          {/* Footer Link */}
          <div className="mt-8 text-center text-sm text-[#434654] border-t border-[#e1e2ec] pt-6">
            {footerText}{" "}
            <Link
              href={footerLink}
              className="font-semibold text-[#003d9b] hover:text-[#0040a2] transition-colors tracking-[0.01em]"
            >
              {footerLinkText}
            </Link>
          </div>
        </div>

        {/* Footer Copyright */}
        <p className="text-center text-xs text-[#737685] mt-6">
          © {new Date().getFullYear()} Corporate Portal. All rights reserved.
        </p>
      </div>
    </main>
  );
}
