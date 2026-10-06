import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { MatrixRain } from "@/components/matrix-rain";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JPR Command Center",
  description: "Run JPR from one place.",
  robots: { index: false, follow: false },
  // Installable: "Add to Home Screen" opens it full screen with its own icon.
  applicationName: "JPR",
  appleWebApp: { capable: true, title: "JPR", statusBarStyle: "black" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#060e1c" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // JARVIS or Matrix, chosen in Settings.
  const jar = await cookies();
  const theme = jar.get("jpr-theme")?.value === "matrix" ? "matrix" : "jarvis";
  const rain = jar.get("jpr-rain")?.value === "off" ? "off" : "on";
  return (
    <html lang="en" data-theme={theme} data-rain={rain} className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        {/* With credentials so the manifest loads behind Vercel sign-in. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="antialiased">
        <MatrixRain />
        {children}
      </body>
    </html>
  );
}
