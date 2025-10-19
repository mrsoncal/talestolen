import React from 'react';
import { LiveSync } from '../sync/webrtcSync';

/*const LiveSyncCard = React.forwardRef(function LiveSyncCard(
  { onMessageRef, onConnected },
  ref
) {
  const [mode, setMode] = React.useState('idle'); // idle | host | join | connected
  const [offerText, setOfferText] = React.useState('');
  const [answerText, setAnswerText] = React.useState('');
  const [err, setErr] = React.useState('');
  const syncRef = React.useRef(null);
  const connectedRef = React.useRef(false);
  const watchTimerRef = React.useRef(null);

  React.useImperativeHandle(ref, () => ({
    send: (msg) => {
      try { syncRef.current?.send?.(msg); } catch (e) { console.warn('[LiveSyncCard] send failed:', e); }
    },
    disconnect: () => {
      try { syncRef.current?.close?.(); } catch {}
      connectedRef.current = false;
      clearWatch();
      setMode('idle');
    },
    getState: () => ({
      mode,
      channelReady: !!syncRef.current?.channel && syncRef.current.channel.readyState === 'open',
    }),
  }), [mode]);

  React.useEffect(() => {
    return () => { try { syncRef.current?.close() } catch {}; clearWatch(); };
  }, []);

  function clearWatch() {
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
  }
  function startWatchForOpen() {
    clearWatch();
    watchTimerRef.current = setInterval(() => {
      const ch = syncRef.current?.channel;
      if (ch && ch.readyState === 'open') {
        clearWatch();
        if (!connectedRef.current) {
          connectedRef.current = true;
          setMode('connected');
          try { onConnected?.(); } catch {}
          console.log('[LiveSyncCard] channel open → connected');
        }
      }
    }, 150);
  }

  function resetAll(nextMode = 'idle') {
    try { syncRef.current?.close(); } catch {}
    syncRef.current = null;
    connectedRef.current = false;
    clearWatch();
    setOfferText('');
    setAnswerText('');
    setErr('');
    setMode(nextMode);
  }

  async function startHost() {
    try {
      resetAll();
      syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef?.current?.(m) });
      window._ls = syncRef.current;
      const sdp = await syncRef.current.createOffer();
      setOfferText(sdp);
      setMode('host');
      startWatchForOpen();
      console.log('[LiveSyncCard] host mode, offer ready');
    } catch (e) { console.error(e); setErr('Failed to start Host.'); }
  }

  async function acceptAnswer() {
    try {
      const payload = (answerText || '').trim();
      if (!payload) return setErr('Paste the Answer first.');
      await syncRef.current.acceptAnswer(payload);
      setErr('');
      console.log('[LiveSyncCard] host accepted answer, waiting for channel open…');
    } catch (e) { console.error(e); setErr('Failed to accept Answer.'); }
  }

  async function startJoin() {
    try {
      resetAll();
      syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef?.current?.(m) });
      window._ls = syncRef.current;
      setMode('join');
      startWatchForOpen();
      console.log('[LiveSyncCard] join mode');
    } catch (e) { console.error(e); setErr('Failed to start Join.'); }
  }

  async function pasteOfferAndCreateAnswer() {
    try {
      const payload = (offerText || '').trim();
      if (!payload) return setErr('Paste the Host Offer first.');
      const sdp = await syncRef.current.receiveOffer(payload);
      setAnswerText(sdp);
      setErr('');
      console.log('[LiveSyncCard] join created answer, waiting for host connect…');
    } catch (e) { console.error(e); setErr('Failed to create Answer from Offer.'); }
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
});

export default LiveSyncCard;*/
