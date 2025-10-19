export default function Queue({ state, layout }) {
  const list = Array.isArray(state?.queue) ? state.queue : [];
  return (
    <div className="list">
      {list.length === 0 ? (
        <div className="muted">Queue is empty.</div>
      ) : (
        list.map((q) => (
          <div key={q.id} className="queue-item">
            <div className="big">{q.name}</div>
            <div className="muted">{q.org || ''}</div>
          </div>
        ))
      )}
    </div>
  );
}
