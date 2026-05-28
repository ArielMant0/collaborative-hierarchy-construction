// Handles PeerJS connections, binary data routing, and peer lifecycle. Unaware of Vue

import Peer from 'peerjs';

export const DEBUG_NETWORK = true;

const webrtcConfig = {
  debug: 3, // Forces PeerJS to log exactly why a connection drops
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

class WebRTCService extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.hostConnection = null;
    this.clientConnections = new Map();
  }

  dispatchEvent(event) {
    if (DEBUG_NETWORK && event instanceof CustomEvent) {
      console.groupCollapsed(`[WebRTC] ${new Date().toISOString()} | ${event.type}`);
      if (event.detail !== undefined) console.dir(event.detail);
      console.groupEnd();
    }
    return super.dispatchEvent(event);
  }

  initHost() {
    this.peer = new Peer(webrtcConfig);
    
    this.peer.on('open', (id) => this.dispatchEvent(new CustomEvent('host-opened', { detail: id })));
    
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.clientConnections.set(conn.peer, conn);
        this.updatePeerList();
        this.dispatchEvent(new CustomEvent('client-joined', { detail: conn.peer }));
      });

      conn.on('data', (data) => this.handleData(conn, data));
      
      conn.on('close', () => {
        this.clientConnections.delete(conn.peer);
        this.updatePeerList();
        this.dispatchEvent(new CustomEvent('client-left', { detail: conn.peer }));
      });
    });

    this.peer.on('error', (err) => this.dispatchEvent(new CustomEvent('error', { detail: err })));
  }

  joinHost(hostId) {
    this.peer = new Peer(webrtcConfig);
    
    this.peer.on('open', (id) => {
      this.dispatchEvent(new CustomEvent('client-opened', { detail: id }));
      this.hostConnection = this.peer.connect(hostId);
      
      this.hostConnection.on('open', () => {
        this.dispatchEvent(new CustomEvent('connected-to-host'));
        this.hostConnection.send({ type: 'PING' });
      });

      this.hostConnection.on('data', (data) => this.handleData(this.hostConnection, data));
      this.hostConnection.on('close', () => this.dispatchEvent(new CustomEvent('host-disconnected')));
    });

    this.peer.on('error', (err) => this.dispatchEvent(new CustomEvent('error', { detail: err })));
  }

  handleData(conn, data) {
    // ROUTER: Control messages (JSON)
    if (data && data.type) {
      if (data.type === 'PEER_LIST') {
        this.dispatchEvent(new CustomEvent('peer-list-updated', { detail: data.list }));
      } else if (data.type === 'PING') {
        const sender = data.sender === 'HOST' ? 'Host' : `${data.sender || conn.peer}`;
        this.dispatchEvent(new CustomEvent('ping-received', { detail: sender }));
        // If host, forward ping to others
        if (this.clientConnections.size > 0 && !data.sender) {
          this.broadcast({ type: 'PING', sender: conn.peer });
        }
      } else if (data.type === 'WELCOME_SYNC') {
        // Intercept the forced state overwrite from the Host
        this.dispatchEvent(new CustomEvent('welcome-sync', { detail: data.payload }));
      }
      return;
    }

    // ROUTER: CRDT Data (Pure Binary)
    this.dispatchEvent(new CustomEvent('crdt-update-received', { detail: { data, peer: conn.peer } }));
  }

  updatePeerList() {
    const list = Array.from(this.clientConnections.keys());
    this.broadcast({ type: 'PEER_LIST', list: list });
    this.dispatchEvent(new CustomEvent('peer-list-updated', { detail: list }));
  }

  broadcast(data, excludePeerId = null) {
    if (DEBUG_NETWORK) {
      const size = data.byteLength || JSON.stringify(data).length;
      console.log(`[WebRTC: Outgoing Broadcast] Size: ${size}b | Excluded: ${excludePeerId}`);
    }
    this.clientConnections.forEach((conn, peerId) => {
      if (conn.open && peerId !== excludePeerId) conn.send(data);
    });
  }

  sendToPeer(peerId, data) {
    const conn = this.clientConnections.get(peerId);
    if (conn && conn.open) {
      if (DEBUG_NETWORK) {
        const size = data.byteLength || JSON.stringify(data).length;
        console.log(`[WebRTC: Outgoing Direct -> ${peerId}] Size: ${size}b`);
      }
      conn.send(data);
    }
  }

  sendUpdate(update, isHost) {
    if (isHost) {
      this.broadcast(update);
    } else if (this.hostConnection && this.hostConnection.open) {
      if (DEBUG_NETWORK) {
        const size = update.byteLength || JSON.stringify(update).length;
        console.log(`[WebRTC: Outgoing Update -> Host] Size: ${size}b`);
      }
      this.hostConnection.send(update);
    }
  }

  sendPing(isHost) {
    if (isHost) {
      this.broadcast({ type: 'PING', sender: 'HOST' });
    } else if (this.hostConnection) {
      if (DEBUG_NETWORK) console.log(`[WebRTC: Outgoing Ping -> Host]`);
      this.hostConnection.send({ type: 'PING' });
    }
  }
}

export const webrtcService = new WebRTCService();