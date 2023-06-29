import { nanoid } from "nanoid"
import { Subject, Observable, filter, firstValueFrom, map, BehaviorSubject, SubscriptionLike, timeout } from "rxjs"
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
    const url = new URL(location.href)
    if (url.searchParams.get('singleUseToken')) {
      const session = await firstValueFrom(this.send<ISession | null>('UseSingleUseToken', url.searchParams.get('singleUseToken')).response.pipe(timeout(5000)))
      if (session) {
        localStorage.setItem('sessionId', session.id)
        this.auth.next(true)
        this.whenAuthReadyResolver()
        return session
      }
    } else {
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
    return  null
  }

  public logout() {
    localStorage.removeItem('sessionId')
    this.auth.next(false)
    this.roles.next(null)
    this.user.next(null)
    this.send('Logout')
  }

  public async login(initialRoute?: string) {
    const loginEndpoint = `https://auth.tda.website/${this.options.domain ?? window.location.hostname}${initialRoute ? `/${initialRoute}` : ''}`
    const backendDomain = this.endpoint.replace('wss://', '').replace('/ws', '').split('/')[0]
    const token = await this.getClientToken()
    window.location.href = `${loginEndpoint}?token=${token}&domain=${backendDomain}&return=${window.location.href}`, 'Login'
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
