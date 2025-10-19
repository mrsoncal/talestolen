// src/sync/webrtcSync.js
// Minimal WebRTC DataChannel sync with manual copy/paste signaling.

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

export class LiveSync {
  constructor({ onMessage } = {}) {
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.channel = null;
    this.onMessage = onMessage || (() => {});
    this.iceQueue = [];
    this._wire();
  }

  _wire() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.iceQueue.push(e.candidate);
    };
    this.pc.ondatachannel = (e) => {
      this.channel = e.channel;
      this._bindChannel();
    };
  }

  _bindChannel() {
    if (!this.channel) return;
    this.channel.onopen = () => console.log('[LiveSync] channel open');
    this.channel.onclose = () => console.log('[LiveSync] channel closed');
    this.channel.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)); }
      catch (err) { console.warn('[LiveSync] bad message', err); }
    };
  }

  // HOST FLOW
  async createOffer() {
    this.channel = this.pc.createDataChannel('talestolen');
    this._bindChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._waitIceGatheringComplete();
    return JSON.stringify(this.pc.localDescription);
  }
  async acceptAnswer(answerStr) {
    const answer = JSON.parse(answerStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // JOIN FLOW
  async receiveOffer(offerStr) {
    const offer = JSON.parse(offerStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitIceGatheringComplete();
    return JSON.stringify(this.pc.localDescription);
  }

  async _waitIceGatheringComplete() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise(res => {
      const check = () => (this.pc.iceGatheringState === 'complete') && res();
      const iv = setInterval(() => {
        if (this.pc.iceGatheringState === 'complete') { clearInterval(iv); res(); }
      }, 50);
    });
  }

  send(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    }
  }

  close() {
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
  }
}
