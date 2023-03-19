import { nanoid } from "nanoid";
import { Subject, Observable, filter, firstValueFrom, map } from "rxjs";
import { ReconnectingWebSocket } from "./reconnecting-ws";

export class WsClient {

  private ws: ReconnectingWebSocket;

  private eventStream = new Subject<IMessage<any>>();

  readonly timeoutSeconds = 5;

  constructor(endpoint: string) {
    this.ws = new ReconnectingWebSocket(endpoint)
    this.ws.messageStream.subscribe(message => {
      // check if data looks like json
      if (message[0] === '{') {
        const parsed = JSON.parse(message) as IMessage<any>
        if (parsed && parsed.subject) {
          this.eventStream.next(parsed)
          return
        }
      }
      console.error('Error parsing json in ws incoming', message)
    })
  }

  public send<TResponse = any>(subject: string, data?: any): TSendOutput<TResponse>
  public send<TResponse = any>(message: IMessage<any>): TSendOutput<TResponse>
  public send<TResponse = any>(message: IMessage<any> | string, data?: any): TSendOutput<TResponse> {
    if (typeof message === 'string') {
      message = { subject: message, data }
    }
    if (!message.id) {
      message.id = nanoid()
    }
    this.ws.send(JSON.stringify(message))
    const messageObj = message
    return {
      data: this.eventStream.pipe(filter(e => e.id === messageObj.id && e.error === null), map(e => e.data)),
      error: this.eventStream.pipe(filter(e => e.id === messageObj.id && e.error !== null), map(e => e.error)) as Observable<string>,
    }
  }

  public on<T>(subject: string): Observable<IMessage<T>> {
    return this.eventStream.pipe(filter(e => e.subject === subject))
  }

  public onError<T>(subject: string): Observable<IMessage<string>> {
    return this.eventStream.pipe(filter(e => e.subject === subject && e.error !== null))
  }

  public destroy() {
    this.ws.destroy();
  }

}

export interface IMessage<T> {
  id?: string
  subject?: string
  data: T
  error?: string | null
}

type TSendOutput<T> = {
  data: Observable<T>;
  error: Observable<string>;
}
