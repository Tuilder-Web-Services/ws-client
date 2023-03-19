import { BehaviorSubject, Subject } from "rxjs";

export enum EConnectionState {
  connected,
  disconnected,
  error
}

export class ReconnectingWebSocket {

  private socket: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionQueue: string[] = [];

  public connectionState = new BehaviorSubject<EConnectionState>(EConnectionState.disconnected);
  public messageStream = new Subject<string>();

  constructor(
    private url: string,
    private reconnectInterval: number = 1000,
    private maxReconnectInterval: number = 10000) {
    this.connect();
    this.setupConnectionEvents();
  }

  public send(message: string): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(message);
      return true;
    }
    this.connectionQueue.push(message);
    return false;
  }

  private connect() {
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', this.handleOpenEvent);
    this.socket.addEventListener('message', this.handleMessageEvent);
    this.socket.addEventListener('close', this.handleCloseEvent);
    this.socket.addEventListener('error', this.handleErrorEvent);
  }

  private handleOpenEvent = (ev: Event) => this.handleEvent(WebsocketEvents.open, ev);
  private handleCloseEvent = (ev: CloseEvent) => this.handleEvent(WebsocketEvents.close, ev);
  private handleErrorEvent = (ev: Event) => this.handleEvent(WebsocketEvents.error, ev);
  private handleMessageEvent = (ev: MessageEvent) => this.handleEvent(WebsocketEvents.message, ev);

  private handleEvent<K extends WebsocketEvents>(type: K, ev: WebsocketEventMap[K]) {
    switch (type) {
      case WebsocketEvents.close:
        this.scheduleReconnect()
        break;
      case WebsocketEvents.open:
        this.reconnectInterval = 1000;
        this.connectionState.next(EConnectionState.connected);
        let m = this.connectionQueue.shift()
        while (m !== undefined) {
          this.send(m)
          m = this.connectionQueue.shift()
        }
        break;
      case WebsocketEvents.message:
        this.messageStream.next((ev as MessageEvent<any>).data);
        break;
      case WebsocketEvents.error:
        this.connectionState.next(EConnectionState.error);
        console.error('WebSocket error:', ev);
        break;
    }
  }

  private scheduleReconnect() {
    this.destroy()
    this.reconnectTimeout = setTimeout(() => {
      if (navigator.onLine) {
        console.log('Attempting to reconnect...');
        this.connect();
      } else {
        this.scheduleReconnect();
      }
      this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
    }, this.reconnectInterval);
  }

  private setupConnectionEvents() {
    window.addEventListener('online', () => {
      console.log('Internet connection is back online. Reconnecting...');
      this.reconnectInterval = 1000;
      this.scheduleReconnect();
    })
    window.addEventListener('offline', () => {
      console.log('Internet connection is offline. Waiting to reconnect...');
    })
  }

  public destroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.socket !== null) {
      this.socket.removeEventListener(WebsocketEvents.open, this.handleOpenEvent);
      this.socket.removeEventListener(WebsocketEvents.close, this.handleCloseEvent);
      this.socket.removeEventListener(WebsocketEvents.error, this.handleErrorEvent);
      this.socket.removeEventListener(WebsocketEvents.message, this.handleMessageEvent);
      this.socket.close();
    }
  }
}

export enum WebsocketEvents {
  open = 'open',
  close = 'close',
  error = 'error',
  message = 'message'
}

interface WebsocketEventMap {
  close: CloseEvent;
  error: Event;
  message: MessageEvent;
  open: Event;
}
