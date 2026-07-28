import type { NextConfig } from "next"

const nextConfig: NextConfig =
  process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://127.0.0.1:4177/api/:path*",
            },
          ]
        },
      }
    : {
        output: "export",
        images: { unoptimized: true },
      }

export default nextConfig
