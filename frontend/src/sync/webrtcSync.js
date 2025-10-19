// src/sync/webrtcSync.js
// Minimal WebRTC DataChannel sync with manual copy/paste signaling (LAN friendly).

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

export class LiveSync {
  constructor({ onMessage } = {}) {
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.channel = null;
    this.onMessage = onMessage || (() => {});
    this._wire();
  }

  _wire() {
    // Helpful logs
    this.pc.onconnectionstatechange = () => {
      console.log('[LiveSync] pc state:', this.pc.connectionState);
    };
    this.pc.oniceconnectionstatechange = () => {
      console.log('[LiveSync] ice state:', this.pc.iceConnectionState);
    };
    this.pc.onicegatheringstatechange = () => {
      console.log('[LiveSync] ice gathering:', this.pc.iceGatheringState);
    };

    // When joining, host created the channel; we must attach to it here.
    this.pc.ondatachannel = (e) => {
      console.log('[LiveSync] ondatachannel', e.channel?.label);
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
    // Host creates the DataChannel
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

  // Utilities
  _waitIceGatheringComplete() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', check);
      // Fallback polling (some browsers fire late)
      const iv = setInterval(() => {
        if (this.pc.iceGatheringState === 'complete') {
          clearInterval(iv);
          this.pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      }, 100);
    });
  }

  send(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    } else {
      console.warn('[LiveSync] send skipped; channel not open');
    }
  }

  close() {
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
  }
}
