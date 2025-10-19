// src/sync/webrtcSync.js
// WebRTC DataChannel sync with manual copy/paste signaling (LAN friendly) + deep diagnostics.

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
let _instanceCounter = 0;

export class LiveSync {
  constructor({ onMessage } = {}) {
    this.id = ++_instanceCounter;
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.channel = null;
    this.onMessage = onMessage || (() => {});
    this._closedBy = null;

    console.log(`[LiveSync#${this.id}] ctor`);
    this._wire();
  }

  _wire() {
    this.pc.onconnectionstatechange = () => {
      console.log(`[LiveSync#${this.id}] pc state:`, this.pc.connectionState);
    };
    this.pc.onsignalingstatechange = () => {
      console.log(`[LiveSync#${this.id}] signaling:`, this.pc.signalingState);
    };
    this.pc.oniceconnectionstatechange = () => {
      console.log(`[LiveSync#${this.id}] ice state:`, this.pc.iceConnectionState);
    };
    this.pc.onicegatheringstatechange = () => {
      console.log(`[LiveSync#${this.id}] ice gathering:`, this.pc.iceGatheringState);
    };
    this.pc.onicecandidateerror = (e) => {
      console.warn(`[LiveSync#${this.id}] ice candidate error`, e);
    };

    this.pc.ondatachannel = (e) => {
      console.log(`[LiveSync#${this.id}] ondatachannel`, e.channel?.label);
      this.channel = e.channel;
      this._bindChannel();
    };
  }

  _bindChannel() {
    if (!this.channel) return;
    const label = this.channel.label;
    this.channel.onopen = () => console.log(`[LiveSync#${this.id}] channel open (${label})`);
    this.channel.onclose = () => {
      console.log(`[LiveSync#${this.id}] channel closed (${label}) ${this._closedBy ? `(by ${this._closedBy})` : ''}`);
    };
    this.channel.onerror = (e) => console.error(`[LiveSync#${this.id}] channel error`, e);
    this.channel.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)); }
      catch (err) { console.warn(`[LiveSync#${this.id}] bad message`, err); }
    };
  }

  // HOST FLOW
  async createOffer() {
    console.log(`[LiveSync#${this.id}] createOffer()`);
    this.channel = this.pc.createDataChannel('talestolen');
    this._bindChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._waitIceGatheringComplete();
    const out = JSON.stringify(this.pc.localDescription);
    console.log(`[LiveSync#${this.id}] offer ready (${out.length} chars)`);
    return out;
  }

  async acceptAnswer(answerStr) {
    console.log(`[LiveSync#${this.id}] acceptAnswer(${answerStr.length} chars)`);
    const answer = JSON.parse(answerStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // JOIN FLOW
  async receiveOffer(offerStr) {
    console.log(`[LiveSync#${this.id}] receiveOffer(${offerStr.length} chars)`);
    const offer = JSON.parse(offerStr);
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitIceGatheringComplete();
    const out = JSON.stringify(this.pc.localDescription);
    console.log(`[LiveSync#${this.id}] answer ready (${out.length} chars)`);
    return out;
  }

  _waitIceGatheringComplete() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    console.log(`[LiveSync#${this.id}] waiting ice complete...`);
    return new Promise((resolve) => {
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', check);
          console.log(`[LiveSync#${this.id}] ice complete.`);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', check);
      const iv = setInterval(() => {
        if (this.pc.iceGatheringState === 'complete') {
          clearInterval(iv);
          this.pc.removeEventListener('icegatheringstatechange', check);
          console.log(`[LiveSync#${this.id}] ice complete (poll).`);
          resolve();
        }
      }, 100);
    });
  }

  send(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    } else {
      console.warn(`[LiveSync#${this.id}] send skipped; channel not open`);
    }
  }

  close() {
    this._closedBy = 'app';
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    console.log(`[LiveSync#${this.id}] close()`);
  }
}
