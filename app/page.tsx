export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
      <h1>🐿️ 다람쥐 택시 API 서버</h1>
      <p>이 레포는 백엔드(API) 전용입니다. 프론트엔드는 <code>daramjwi-taxi-client</code> 레포에 있습니다.</p>
      <p>
        서버 상태 확인: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
