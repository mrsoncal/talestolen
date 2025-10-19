import React from 'react';
import { LiveSync } from '../sync/webrtcSync';

export default function LiveSyncCard({ onMessageRef }) {
  const [mode, setMode] = React.useState('idle'); // idle | host | join | connected
  const [offerText, setOfferText] = React.useState('');
  const [answerText, setAnswerText] = React.useState('');
  const syncRef = React.useRef(null);

  React.useEffect(() => () => { syncRef.current?.close(); }, []);

  async function startHost() {
    syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef.current?.(m) });
    const sdp = await syncRef.current.createOffer();
    setOfferText(sdp);
    setMode('host');
  }

  async function acceptAnswer() {
    await syncRef.current.acceptAnswer(answerText);
    setMode('connected');
  }

  async function startJoin() {
    syncRef.current = new LiveSync({ onMessage: (m) => onMessageRef.current?.(m) });
    setMode('join');
  }

  async function pasteOfferAndCreateAnswer() {
    const sdp = await syncRef.current.receiveOffer(offerText);
    setAnswerText(sdp);
    // Now user copies `answerText` back to host
  }

  return (
    <div className="card">
      <div className="title">Live Sync (LAN / P2P)</div>
      {mode === 'idle' && (
        <div className="row" style={{gap:8}}>
          <button className="btn" onClick={startHost}>Host</button>
          <button className="btn secondary" onClick={startJoin}>Join</button>
        </div>
      )}

      {mode === 'host' && (
        <>
          <div className="muted">1) Share this Offer with the other device</div>
          <textarea className="input" rows={6} value={offerText} readOnly />
          <div className="muted">2) Paste their Answer below and press “Connect”</div>
          <textarea className="input" rows={6} value={answerText} onChange={e=>setAnswerText(e.target.value)} />
          <div className="row" style={{gap:8}}>
            <button className="btn" onClick={acceptAnswer}>Connect</button>
          </div>
        </>
      )}

      {mode === 'join' && (
        <>
          <div className="muted">1) Paste the Host’s Offer here</div>
          <textarea className="input" rows={6} value={offerText} onChange={e=>setOfferText(e.target.value)} />
          <div className="row" style={{gap:8}}>
            <button className="btn" onClick={pasteOfferAndCreateAnswer}>Create Answer</button>
          </div>
          <div className="muted">2) Send this Answer back to the Host</div>
          <textarea className="input" rows={6} value={answerText} readOnly />
        </>
      )}

      {mode === 'connected' && <div className="badge">Connected</div>}
    </div>
  );
}

// Helper to send messages from parent
export function useLiveSyncSender(liveSyncRef) {
  return React.useCallback((msg) => {
    liveSyncRef.current?.send(msg);
  }, []);
}
