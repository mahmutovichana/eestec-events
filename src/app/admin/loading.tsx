export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Učitavanje">
      <div className="skel" style={{ height: 40, width: "40%" }} />
      <div className="skel" style={{ height: 120, marginTop: 24 }} />
      <div className="skel" style={{ height: 120, marginTop: 16 }} />
    </div>
  );
}
