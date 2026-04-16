// Handles PeerJS connections, binary data routing, and peer lifecycle. Unaware of Vue

import Peer from 'peerjs';

class WebRTCService extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.hostConnection = null;
    this.clientConnections = new Map();
  }

  initHost() {
    this.peer = new Peer();
    
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
    this.peer = new Peer();
    
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
    this.clientConnections.forEach((conn, peerId) => {
      if (conn.open && peerId !== excludePeerId) conn.send(data);
    });
  }

  sendToPeer(peerId, data) {
    const conn = this.clientConnections.get(peerId);
    if (conn && conn.open) {
      conn.send(data);
    }
  }

  sendUpdate(update, isHost) {
    if (isHost) {
      this.broadcast(update);
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(update);
    }
  }

  sendPing(isHost) {
    if (isHost) {
      this.broadcast({ type: 'PING', sender: 'HOST' });
    } else if (this.hostConnection) {
      this.hostConnection.send({ type: 'PING' });
    }
  }
}

export const webrtcService = new WebRTCService();