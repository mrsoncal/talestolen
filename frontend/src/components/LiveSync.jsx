import React from 'react';
import { LiveSync } from '../sync/webrtcSync';

export default function LiveSyncCard({ onMessageRef }) {
  const [mode, setMode] = React.useState('idle'); // idle | host | join | connected
  const [offerText, setOfferText] = React.useState('');
  const [answerText, setAnswerText] = React.useState('');
  const [err, setErr] = React.useState('');
  const syncRef = React.useRef(null);

  React.useEffect(() => {
    return () => { try { syncRef.current?.close() } catch {} };
  }, []);

  function resetAll(nextMode = 'idle') {
    // Do NOT close if already connected unless explicitly disconnecting
    if (mode !== 'connected') {
      try { syncRef.current?.close() } catch {}
    }
    syncRef.current = null;
    setOfferText('');
    setAnswerText('');
    setErr('');
    setMode(nextMode);
  }

  async function startHost() {
    try {
      resetAll(); // ensure clean (not connected)
      syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef?.current?.(m) });
      // expose for quick manual debugging in DevTools
      window._ls = syncRef.current;
      const sdp = await syncRef.current.createOffer();
      setOfferText(sdp);
      setMode('host');
      console.log('[LiveSyncCard] host mode, offer ready');
    } catch (e) {
      console.error(e); setErr('Failed to start Host.');
    }
  }

  async function acceptAnswer() {
    try {
      const payload = (answerText || '').trim();
      if (!payload) return setErr('Paste the Answer first.');
      await syncRef.current.acceptAnswer(payload);
      setMode('connected');
      setErr('');
      console.log('[LiveSyncCard] connected (host)');
    } catch (e) {
      console.error(e); setErr('Failed to accept Answer.');
    }
  }

  async function startJoin() {
    try {
      resetAll(); // ensure clean
      syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef?.current?.(m) });
      window._ls = syncRef.current;
      setMode('join');
      console.log('[LiveSyncCard] join mode');
    } catch (e) {
      console.error(e); setErr('Failed to start Join.');
    }
  }

  async function pasteOfferAndCreateAnswer() {
    try {
      const payload = (offerText || '').trim();
      if (!payload) return setErr('Paste the Host Offer first.');
      const sdp = await syncRef.current.receiveOffer(payload);
      setAnswerText(sdp);
      setErr('');
      console.log('[LiveSyncCard] answer created');
    } catch (e) {
      console.error(e); setErr('Failed to create Answer from Offer.');
    }
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard?.writeText(text || ''); } catch {}
  }

  return (
    <div className="card">
      <div className="title">Live Sync (LAN / P2P)</div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={startHost} disabled={mode === 'connected'}>Host</button>
        <button className="btn secondary" onClick={startJoin} disabled={mode === 'connected'}>Join</button>

        {(mode === 'host' || mode === 'join') && (
          <button className="btn ghost" onClick={() => resetAll('idle')}>Back</button>
        )}
        {mode === 'connected' && (
          <button className="btn danger" onClick={() => resetAll('idle')}>Disconnect</button>
        )}

        <span className="badge">
          {mode === 'idle' ? 'Idle' : mode === 'host' ? 'Hosting' : mode === 'join' ? 'Joining' : 'Connected'}
        </span>
      </div>

      {err && (<div className="muted" style={{ color: 'var(--danger, #c00)', marginTop: 8 }}>{err}</div>)}

      {mode === 'host' && (
        <>
          <div className="spacer"></div>
          <div className="muted">1) Share this Offer with the joining device</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={() => copyToClipboard(offerText)}>Copy Offer</button>
          </div>
          <textarea className="input" rows={6} value={offerText} readOnly />

          <div className="spacer"></div>
          <div className="muted">2) Paste their Answer here, then press “Connect”</div>
          <textarea
            className="input"
            rows={6}
            placeholder='Paste {"type":"answer","sdp":"..."} here'
            value={answerText}
            onChange={e => setAnswerText(e.target.value)}
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={acceptAnswer}>Connect</button>
          </div>
        </>
      )}

      {mode === 'join' && (
        <>
          <div className="spacer"></div>
          <div className="muted">1) Paste Host’s Offer here</div>
          <textarea
            className="input"
            rows={6}
            placeholder='Paste {"type":"offer","sdp":"..."} here'
            value={offerText}
            onChange={e => setOfferText(e.target.value)}
          />

          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={pasteOfferAndCreateAnswer}>Create Answer</button>
          </div>

          <div className="spacer"></div>
          <div className="muted">2) Send this Answer back to the Host</div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn ghost"
              onClick={() => copyToClipboard(answerText)}
              disabled={!answerText.trim()}
            >
              Copy Answer
            </button>
          </div>
          <textarea className="input" rows={6} value={answerText} readOnly />
        </>
      )}

      {mode === 'connected' && (
        <>
          <div className="spacer"></div>
          <div className="muted">Connected. Timer actions & type durations mirror instantly.</div>
        </>
      )}
    </div>
  );
}
