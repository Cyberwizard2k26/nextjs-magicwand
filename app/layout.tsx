import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/shell/providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MagicWand RMM", template: "%s · MagicWand" },
  description: "Remote monitoring and management for modern IT teams.",
  applicationName: "MagicWand RMM",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#090b10", width: "device-width", initialScale: 1 };

const themeScript = `(function(){try{var t=localStorage.getItem('mw.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased relative z-[1]`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
