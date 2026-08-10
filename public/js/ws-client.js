// WebSocket and Server-Sent Events (SSE) Client implementation.

let currentSocket = null;
let currentEventSource = null;

export function isConnected() {
  return currentSocket !== null || currentEventSource !== null;
}

export function disconnect() {
  if (currentSocket) {
    currentSocket.close();
    currentSocket = null;
  }
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
}

export function connectWs(url, { onLog, onStateChange }) {
  disconnect();
  
  onStateChange('connecting');
  onLog('info', `Connecting to WebSocket: ${url}`);
  
  try {
    const socket = new WebSocket(url);
    currentSocket = socket;
    
    socket.onopen = () => {
      if (currentSocket !== socket) return;
      onStateChange('connected');
      onLog('info', 'WebSocket connection established successfully.');
    };
    
    socket.onmessage = (event) => {
      if (currentSocket !== socket) return;
      onLog('in', event.data);
    };
    
    socket.onclose = (event) => {
      if (currentSocket === socket) {
        currentSocket = null;
        onStateChange('disconnected');
        onLog('info', `WebSocket connection closed. Code: ${event.code}${event.reason ? ` (${event.reason})` : ''}`);
      }
    };
    
    socket.onerror = (error) => {
      if (currentSocket !== socket) return;
      onLog('info', `WebSocket error occurred.`);
    };
  } catch (err) {
    onStateChange('disconnected');
    onLog('info', `Failed to open WebSocket: ${err.message}`);
  }
}

export function sendWsMessage(message, { onLog }) {
  if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
    currentSocket.send(message);
    onLog('out', message);
    return true;
  } else {
    onLog('info', 'Cannot send message: WebSocket is disconnected.');
    return false;
  }
}

export function connectSse(url, { onLog, onStateChange }) {
  disconnect();
  
  onStateChange('connecting');
  onLog('info', `Subscribing to SSE Stream: ${url}`);
  
  try {
    const es = new EventSource(url);
    currentEventSource = es;
    
    es.onopen = () => {
      if (currentEventSource !== es) return;
      onStateChange('connected');
      onLog('info', 'SSE connection opened.');
    };
    
    es.onmessage = (event) => {
      if (currentEventSource !== es) return;
      onLog('in', event.data);
    };
    
    // Also listen to custom events if possible, or just default message.
    es.onerror = (err) => {
      if (currentEventSource !== es) return;
      onLog('info', 'SSE connection error/disconnected.');
    };
  } catch (err) {
    onStateChange('disconnected');
    onLog('info', `Failed to open SSE: ${err.message}`);
  }
}
