import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SkimTheCream",
  description: "AI-powered deal finding and flipping assistant",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {/* Branded header */}
        <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800/50">
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-zinc-100">SKIM</span>
              <span className="text-emerald-400">THE</span>
              <span className="text-zinc-100">CREAM</span>
            </h1>
          </div>
        </header>
        <main className="flex-1 pb-20">{children}</main>
        <Nav />
      </body>
    </html>
  );
}
