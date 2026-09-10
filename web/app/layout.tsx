import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Oxanium } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const heading = Geist({ subsets: ["latin"], variable: "--font-heading" })
const sans = Oxanium({ subsets: ["latin"], variable: "--font-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4177"),
  title: "Momento — your bookmarks, written back to you",
  description: "Watch X bookmarks, extract the linked work, and send a daily brief.",
  applicationName: "Momento",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Momento",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", mono.variable, sans.variable, heading.variable)}
    >
      <body>
        <ThemeProvider defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
