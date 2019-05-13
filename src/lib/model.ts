import {Observable} from "rxjs";

import * as PM from "./private/model";

// don't extend NodeJS.EventEmitter
export interface EventListener {
    on: (event: string, listener: (...args: PM.Any[]) => void) => this;
    removeListener: (event: string, listener: (...args: PM.Any[]) => void) => this;
}

// don't extend NodeJS.EventEmitter
export interface EventEmitter {
    emit(event: string, ...args: PM.Any[]): void | boolean;
}

export type CombinedEventEmitter = EventListener & EventEmitter;

export interface Emitters {
    emitter: EventEmitter;
    listener: EventListener;
}

export type EmittersResolver = () => Emitters;

export type ProviderOnEventResolver<ListenerArgs extends PM.Any[] = PM.Any[]> = (
    //  listener args of EventListener.on
    ...args: ListenerArgs
) => {
    payload: PM.Any; // TODO use "PM.Payload<AD>"
    emitter: EventEmitter;
};

export type ClientOnEventResolver<ListenerArgs extends PM.Any[] = PM.Any[]> = (
    //  listener args of EventListener.on
    ...args: ListenerArgs
) => {
    payload: PM.Any; // TODO use "PM.Payload<AD>"
};

export interface CallOptions {
    timeoutMs: number;
    finishPromise?: Promise<PM.Any>;
    listenChannel?: string;
    notificationWrapper?: (fn: (...args: PM.Any[]) => PM.Any) => PM.Any;
    serialization?: "jsan";
    onEventResolver?: ClientOnEventResolver;
}

export type LoggerFn = (...args: PM.Any[]) => void;

export interface Logger {
    error: LoggerFn;
    warn: LoggerFn;
    info: LoggerFn;
    verbose: LoggerFn;
    debug: LoggerFn;
}

export const ACTION_CONTEXT_SYMBOL = Symbol(`${PM.MODULE_NAME_PREFIX}:ACTION_CONTEXT_SYMBOL`);

export interface ActionContext<Args extends PM.Any[] = PM.Any[]> {
    [ACTION_CONTEXT_SYMBOL]: Readonly<{ args: Readonly<Args> }>;
}

type ActionTypeString<T extends "promise" | "observable", IN extends PM.Any[] = [], OUT extends PM.Any = void> = string & {
    type: T,
    in: IN;
    out: OUT;
};

// tslint:disable-next-line:variable-name
export const ActionType = {
    Promise: <IN extends PM.Any[] = [], OUT extends PM.Any = void>() => {
        const result = "promise";
        return result as ActionTypeString<typeof result, IN, OUT>;
    },
    Observable: <IN extends PM.Any[] = [], OUT extends PM.Any = void>() => {
        const result = "observable";
        return result as ActionTypeString<typeof result, IN, OUT>;
    },
} as const;

export type ApiDefinition<T> = {
    // [K in Extract<keyof T, string>]: T[K] extends ReturnType<typeof ActionType.Promise | typeof ActionType.Observable>
    [K in Extract<keyof T, string>]: T[K] extends ActionTypeString<infer OUT_WRAP, infer IN, infer OUT>
        // ? T[K]
        ? ActionTypeString<OUT_WRAP, IN, OUT>
        : never;
};

export type Actions<AD extends ApiDefinition<AD>> = {
    [K in Extract<keyof AD, string>]: AD[K] extends ActionTypeString<infer OUT_WRAP, infer IN, infer OUT>
        ? OUT_WRAP extends "promise" ? (/*this: ActionContext | void,*/ ...args: IN) => Promise<OUT>
            : OUT_WRAP extends "observable" ? (/*this: ActionContext | void,*/ ...args: IN) => Observable<OUT>
                : never
        : never;
};

interface ScanResult<API> {
    Api: API;
    ApiSync: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT>
            ? (...args: IN) => OUT
            : never
    };
    ApiArgs: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT>
            ? IN
            : never
    };
    ApiReturns: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT>
            ? OUT
            : never
    };
}

export type ScanApiDefinition<AD extends ApiDefinition<AD>, API extends Actions<AD> = Actions<AD>> = ScanResult<API>;

export type ScanService<I extends ({
    [RN1 in RN]: I[RN1] extends {
        [RN2 in RN]: <AD extends ApiDefinition<AD>, A extends Actions<AD>>(actions: A, ...rest: infer A) => infer R;
    } ? I[RN1] : never
}) extends never
    ? { [d in RN]: (...args: PM.Any[]) => PM.Any }
    : { [d in RN]: (...args: PM.Any[]) => PM.Any },
    RN extends string = "register",
    API extends PM.Arguments<I[RN]>[0] = PM.Arguments<I[RN]>[0]> = ScanResult<API>;

export interface CreateServiceReturn<AD extends ApiDefinition<AD>> {
    register: <A extends Actions<AD>>(
        actions: A,
        eventEmitter: CombinedEventEmitter,
        options?: { onEventResolver?: ProviderOnEventResolver; logger?: Logger; },
    ) => {
        deregister: () => void;
        resourcesStat: () => { subscriptionsCount: number; }
    };
    call: <A extends Actions<AD>, N extends keyof A>(
        name: N,
        options: CallOptions,
        emitters: Emitters | EmittersResolver,
    ) => A[N];
    caller: (
        emiters: Emitters | EmittersResolver,
        defaultOptions?: CallOptions,
    ) => <A extends Actions<AD>, N extends keyof A>(
        name: N,
        options?: CallOptions,
    ) => A[N];
}

export interface CreateServiceInput<AD extends ApiDefinition<AD>> {
    channel: string;
    apiDefinition: AD;
    callTimeoutMs?: number;
    logger?: Logger;
}

export type CreateServiceOptions<AD extends ApiDefinition<AD>> = Readonly<Required<CreateServiceInput<AD>>>;
