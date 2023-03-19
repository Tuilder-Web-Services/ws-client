import { nanoid } from "nanoid";
import { Subject, Observable, filter, firstValueFrom } from "rxjs";
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

  public send(subject: string, data: any): void
  public send(message: IMessage<any>): void
  public send(message: IMessage<any> | string, data?: any): void {
    if (typeof message === 'string') {
      message = { subject: message, data }
    }
    if (!message.id) {
      message.id = nanoid()
    }
    this.ws.send(JSON.stringify(message))
  }

  public async sendAndWait<TResponse = any>(subject: string, data?: any): Promise<TResponse>
  public async sendAndWait<TResponse = any>(message: IMessage<any>): Promise<TResponse>
  public async sendAndWait<TResponse = any>(message: IMessage<any> | string, data?: any): Promise<TResponse> {
    if (typeof message === 'string') {
      message = { subject: message, data, id: nanoid() }
    }
    const messageId = message.id
    const returnVal = firstValueFrom(this.eventStream.pipe(filter(e => e.id === messageId)))
    this.send(message)
    return (await returnVal).data
  }

  public on<T>(subject: string): Observable<IMessage<T>> {
    return this.eventStream.pipe(filter(e => e.subject === subject))
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
