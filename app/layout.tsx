import type { Metadata } from "next";
import "./globals.css";
import { themeInitScript } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "SJA ERP", description: "ERP CV. Sekar Jaya Abadi" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
