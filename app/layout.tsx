import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "다람쥐 택시 API",
  description: "다람쥐 택시 백엔드 API 서버",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
