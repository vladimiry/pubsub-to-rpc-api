import {Observable} from "rxjs";

// tslint:disable-next-line:no-any
export type AnyType = any;

export type Input = AnyType | never;

export type Output = AnyType | never;

type OutputWrapper<T extends Output> = Observable<T>;

export type Action<I extends Input = Input, O extends Output = Output, R = OutputWrapper<O>> = (arg: I) => R;

export type ActionWithoutInput<O extends Output = Output, R = OutputWrapper<O>> = () => R;

export type ActionsRecord<K extends string> = Record<K, Action | ActionWithoutInput>;

export type PayloadUid = string;

export interface RequestPayload<Name> {
    uid: PayloadUid;
    type: "request";
    name: Name;
    data?: Input;
}

export type ResponsePayload<Name, O> =
    { uid: PayloadUid, type: "response", name: Name } & (
    | { data: O }
    | { data: O, complete?: boolean }
    | { complete?: boolean }
    | { error: AnyType }
    );

export interface EventListener {
    on(event: string, listener: (...args: AnyType[]) => void): this;

    off(event: string, listener: (...args: AnyType[]) => void): this;
}

export interface EventEmitter {
    emit(event: string, ...args: AnyType[]): boolean;
}

export type CombinedEventEmitter = EventListener & EventEmitter;

export interface Emitters {
    emitter: EventEmitter;
    listener: EventListener;
}

export type EmittersResolver = () => Emitters;

export type RequestResolver = (...args: AnyType[]) => {
    payload: AnyType;
    emitter: EventEmitter;
};

export interface CallOptions {
    timeoutMs: number;
    finishPromise?: Promise<AnyType>;
    listenChannel?: string;
    notificationWrapper?: (fn: (...args: AnyType[]) => AnyType) => AnyType;
}

// tslint:disable:no-shadowed-variable
export type UnpackedActionResult<T extends ReturnType<Action>> =
    T extends OutputWrapper<infer U> ? U :
        never;
// tslint:enable:no-shadowed-variable
