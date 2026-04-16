// Wraps webrtc.service.js to expose reactive connection states (isHost, connectedPeers) to the UI

import { reactive, ref, onMounted } from 'vue';
import { webrtcService } from '../services/webrtc.service.js';

export function useNetwork() {
  const netState = reactive({
    isHost: false,
    peerId: null,
    username: 'User-' + Math.floor(Math.random() * 1000),
    status: 'disconnected',
    connectedPeers: [],
    lastMessage: ''
  });

  const joinId = ref('');

  function setupListeners() {
    webrtcService.addEventListener('host-opened', (e) => {
      netState.peerId = e.detail;
      netState.isHost = true;
      netState.status = 'connected';
      netState.lastMessage = "Room created successfully.";
    });
    webrtcService.addEventListener('client-joined', (e) => {
      netState.lastMessage = `Client joined: ${e.detail.substring(0, 5)}...`;
    });
    webrtcService.addEventListener('client-left', (e) => {
      netState.lastMessage = `Client left: ${e.detail.substring(0, 5)}...`;
    });
    webrtcService.addEventListener('client-opened', (e) => {
      netState.peerId = e.detail;
      netState.isHost = false;
    });
    webrtcService.addEventListener('connected-to-host', () => {
      netState.status = 'connected';
      netState.lastMessage = "Connected securely to Host.";
    });
    webrtcService.addEventListener('host-disconnected', () => {
      netState.status = 'disconnected';
      netState.connectedPeers = [];
      netState.lastMessage = "Host disconnected.";
    });
    webrtcService.addEventListener('peer-list-updated', (e) => {
      netState.connectedPeers = e.detail;
    });
    webrtcService.addEventListener('ping-received', (e) => {
      netState.lastMessage = `Ping received from: ${e.detail}`;
    });
    webrtcService.addEventListener('error', (e) => {
      netState.lastMessage = `Error: ${e.detail.type || 'Unknown'}`;
    });
  }

  onMounted(() => setupListeners());

  const initHost = () => {
    netState.status = 'connecting';
    webrtcService.initHost();
  };

  const joinHost = (id) => {
    if (!id) return;
    netState.status = 'connecting';
    webrtcService.joinHost(id);
  };

  return { netState, joinId, initHost, joinHost };
}