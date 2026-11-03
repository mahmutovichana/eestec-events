"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap" style={{ padding: "64px 20px" }}>
      <div className="empty">
        <h2>Nešto je pošlo po zlu</h2>
        <p>Pokušaj ponovo. Ako se greška ponavlja, javi se organizatorima.</p>
        <button className="btn" onClick={reset}>Pokušaj ponovo</button>
      </div>
    </main>
  );
}
