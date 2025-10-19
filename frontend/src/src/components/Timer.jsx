export default function Timer({ state, layout }) {
  // Safe minimal Timer view; fill in later with real timer UI
  const cur = state?.currentSpeaker || null;
  return (
    <div className="list">
      {cur ? (
        <div>
          <div className="big">{cur.name || 'Speaker'}</div>
          <div className="muted">{cur.org || ''}</div>
        </div>
      ) : (
        <div className="muted">No one is speaking.</div>
      )}
    </div>
  );
}
