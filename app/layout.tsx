import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "프로토 분석", description: "해외 배당과 프로토 배당을 비교하고, 베팅 기록과 손실 한도를 관리합니다." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#eaeaea" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body className="min-h-dvh">{children}</body></html>;
}
