import { nanoid } from "nanoid"
import { Subject, Observable, filter, firstValueFrom, map, BehaviorSubject, SubscriptionLike } from "rxjs"
import { ReconnectingWebSocket } from "./reconnecting-ws"
import { IUser } from "./typings/user.interface"
export class WsClient {

  private ws: ReconnectingWebSocket

  private eventStream = new Subject<IMessage<any>>();

  private subs = new Set<SubscriptionLike>()

  readonly timeoutSeconds = 5;

  public whenAuthReady: Promise<void>
  private whenAuthReadyResolver: () => void

  constructor(private endpoint: string, private options: IWsClientOptions = {}) {
    this.whenAuthReady = new Promise<void>(async (resolve) => this.whenAuthReadyResolver = resolve)
    this.ws = new ReconnectingWebSocket(endpoint, () => this.setSession())
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
    this.auth.pipe(filter(a => a)).subscribe(async () => {
      const promises = [
        firstValueFrom(this.send<IUserRole[]>('GetMyRoles').response),
        firstValueFrom(this.send<IUser>('ReadUser').response)
      ] as const
      const [roles, user] = await Promise.all(promises)
      this.roles.next(roles ? new MyRoles(roles) : null)
      this.user.next(user ?? null)
    })
  }

  public send<TResponse = any>(subject: string, data?: any): TSendOutput<TResponse | null>
  public send<TResponse = any>(message: IMessage<any>): TSendOutput<TResponse | null>
  public send<TResponse = any>(message: IMessage<any> | string, data?: any): TSendOutput<TResponse | null> {
    if (typeof message === 'string') {
      message = { subject: message, data }
    }
    if (!message.id) {
      message.id = nanoid()
    }
    this.ws.send(JSON.stringify(message))
    const messageObj = message
    return {
      response: this.eventStream.pipe(filter(e => e.id === messageObj.id && e.error === null), map(e => e.data ?? null)),
      error: this.eventStream.pipe(filter(e => e.id === messageObj.id && e.error !== null), map(e => e.error ?? null)) as Observable<string>,
    }
  }

  public on<T>(subject: string): Observable<IMessage<T>> {
    return this.eventStream.pipe(filter(e => e.subject === subject))
  }

  public onError(subject: string): Observable<IMessage<string>> {
    return this.eventStream.pipe(filter(e => e.subject === subject && e.error !== null))
  }

  public destroy() {
    this.ws.destroy()
    this.subs.forEach(s => s.unsubscribe())
  }

  private async getClientToken(): Promise<string> {
    const { token } = (await firstValueFrom(this.send<{ token: string }>('GetClientToken', null).response)) ?? {}
    return token ?? ''
  }

  public auth = new BehaviorSubject(false)
  public user = new BehaviorSubject<IUser | null>(null)
  public roles = new BehaviorSubject<MyRoles | null>(null)

  public async setSession(): Promise<ISession | null> {
    if (!localStorage.getItem('sessionId')) {
      this.whenAuthReadyResolver()
      return null
    }
    const res = await firstValueFrom(this.send<ISession | null | false>('SetSession', localStorage.getItem('sessionId')).response)
    const isAuth = res !== null && res !== false
    if (isAuth !== this.auth.value) {
      this.auth.next(isAuth)
    }
    this.whenAuthReadyResolver()
    return res || null
  }

  public logout() {
    localStorage.removeItem('sessionId')
    this.auth.next(false)
    this.roles.next(null)
    this.user.next(null)
    this.send('Logout')
  }

  public login(initialRoute?: string) {

    const loginEndpoint = `https://auth.tda.website/${this.options.domain ?? window.location.hostname}${initialRoute ? `/${initialRoute}` : ''}`
    const backendDomain = this.endpoint.replace('wss://', '').replace('/ws', '').split('/')[0]

    return new Promise<void>(async (resolve) => {
      const token = await this.getClientToken()

      const w = 450
      const h = 650

      const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX
      const dualScreenTop  = window.screenTop  !== undefined ? window.screenTop : window.screenY

      const width  = window.innerWidth  ? window.innerWidth  : document.documentElement.clientWidth  ? document.documentElement.clientWidth  : screen.width
      const height = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height

      const systemZoom = width / window.screen.availWidth

      const left = (width - w) / 2 / systemZoom + dualScreenLeft
      const top  = (height - h) / 2 / systemZoom + dualScreenTop

      const features = `scrollbars=yes,width=${w / systemZoom},height=${h / systemZoom},top=${top},left=${left}`

      const popupWindow = window.open(`${loginEndpoint}?token=${token}&domain=${backendDomain}`, 'Login', features)
      if (popupWindow) {
        popupWindow.focus()
        const interval = setInterval(() => {
          if (popupWindow.closed) {
            clearInterval(interval)
            resolve()
          }
        }, 500)
        this.on<ISession>('Session').subscribe(session => {
          popupWindow.close()
          if (session.id) localStorage.setItem('sessionId', session.data.id)
          this.auth.next(true)
        })
      } else {
        console.error('Failed to open the popup window.')
        resolve()
      }
    })

  }

}

export class MyRoles {
  private roleIds = new Set<string>()
  constructor(model: IUserRole[]) {
    model.forEach(r => this.roleIds.add(r.roleId))
  }
  public get isOwner() {
    return this.roleIds.has('owner')
  }
  public get isAdmin() {
    return this.roleIds.has('admin') || this.isOwner
  }
}

export interface IWsClientOptions {
  domain?: string
}

export interface IMessage<T> {
  id?: string
  subject?: string
  data: T
  error?: string | null
}

type TSendOutput<T> = {
  response: Observable<T>
  error: Observable<string>
}

export interface ISession {
  id: string
  userId: string
  expiresDate: Date | null
}

export interface IUserRole {
  userId: string,
  roleId: string,
  name: string,
  permissions: IDbPermissions
}

export interface IDbPermissions {
  default?: Set<EDbOperations>,
  tables?: Record<string, {
    protectedFields?: Set<string>,
    operations?: Set<EDbOperations>,
  }>,
  qualifiers?: Record<string, any>
}

export enum EDbOperations {
  Read,
  Write,
  Delete
}
