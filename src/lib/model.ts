import {Observable} from "rxjs";

// tslint:disable-next-line:no-any
export type TODO = any;

export type Input = TODO | never;

export type Output = TODO | never;

type OutputWrapper<T extends Output> = Observable<T>;

export type Action<I extends Input = Input, O extends Output = Output, R = OutputWrapper<O>> = (arg: I) => R;

export type ActionWithoutInput<O extends Output = Output, R = OutputWrapper<O>> = () => R;

export type ActionsRecord<K extends string> = Record<K, Action | ActionWithoutInput>;

export type PayloadUid = string;

export type RequestPayload<Name> = {
    uid: PayloadUid;
    type: "request";
    name: Name;
    data?: Input;
} & Pick<CallOptions, "serialization">;

export type ResponsePayload<Name, O> =
    { uid: PayloadUid, type: "response", name: Name } & (
    | { data: O }
    | { data: O, complete?: boolean }
    | { complete?: boolean }
    | { error: TODO }
    );

export interface EventListener {
    on(event: string, listener: (...args: TODO[]) => void): this;

    off(event: string, listener: (...args: TODO[]) => void): this;
}

export interface EventEmitter {
    emit(event: string, ...args: TODO[]): boolean;
}

export type CombinedEventEmitter = EventListener & EventEmitter;

export interface Emitters {
    emitter: EventEmitter;
    listener: EventListener;
}

export type EmittersResolver = () => Emitters;

export type RequestResolver = (...args: TODO[]) => {
    payload: TODO;
    emitter: EventEmitter;
};

export interface CallOptions {
    timeoutMs: number;
    finishPromise?: Promise<TODO>;
    listenChannel?: string;
    notificationWrapper?: (fn: (...args: TODO[]) => TODO) => TODO;
    serialization?: "jsan";
}

// tslint:disable:no-shadowed-variable
export type UnpackedActionResult<T extends ReturnType<Action>> =
    T extends OutputWrapper<infer U> ? U :
        never;
// tslint:enable:no-shadowed-variable

export type LoggerFn = (...args: TODO[]) => void;
