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
    notificationWrapper?: <R extends PM.Any>(fn: (...args: PM.Any[]) => R) => R;
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

interface ScanResult<API> {
    ApiImpl: API;
    ApiImplArgs: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT>
            ? IN
            : never
    };
    ApiImplReturns: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT>
            ? OUT
            : never
    };
    ApiClient: PM.DropFunctionsContext<API>;
}

export type ScanService<I extends ({
    [RN1 in RN]: I[RN1] extends {
        [RN2 in RN]: <AD extends ApiDefinition<AD>, A extends Actions<AD>>(actions: A, ...rest: infer A) => infer R;
    } ? I[RN1] : never
}) extends never
    ? { [d in RN]: (...args: PM.Any[]) => PM.Any }
    : { [d in RN]: (...args: PM.Any[]) => PM.Any },
    RN extends string = "register",
    API extends PM.Arguments<I[RN]>[0] = PM.Arguments<I[RN]>[0]> = ScanResult<API>;

type DefACA = PM.Any[];

export type ActionContext<ACA extends DefACA = DefACA> = Readonly<{ args: Readonly<ACA> }>;

type ActionTypeString<T extends "promise" | "observable", IN extends PM.Any = void, OUT extends PM.Any = void> =
    string
    &
    {
        in: IN;
        out: OUT;
        outType: T,
    };

// tslint:disable-next-line:variable-name
export const ActionType = {
    Promise: <IN extends PM.Any = void, OUT extends PM.Any = void>() => {
        const result = "promise";
        return result as ActionTypeString<typeof result, IN, OUT>;
    },
    Observable: <IN extends PM.Any = void, OUT extends PM.Any = void>() => {
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

export type Actions<AD extends ApiDefinition<AD>, ACA extends DefACA | void = void> = {
    [K in Extract<keyof AD, string>]: AD[K] extends ActionTypeString<infer OUT_WRAP, infer IN, infer OUT>
        ? OUT_WRAP extends "promise" ? (this: void | (ACA extends DefACA ? ActionContext<ACA> : void), arg: IN) => Promise<OUT>
            : OUT_WRAP extends "observable" ? (this: void | (ACA extends DefACA ? ActionContext<ACA> : void), arg: IN) => Observable<OUT>
                : never
        : never;
};

export interface CreateServiceReturn<AD extends ApiDefinition<AD>, ACA extends DefACA | void = void> {
    register: <A extends Actions<AD, ACA>>(
        actions: A,
        eventEmitter: CombinedEventEmitter,
        options?: { onEventResolver?: ProviderOnEventResolver; logger?: Logger; },
    ) => {
        deregister: () => void;
        resourcesStat: () => { subscriptionsCount: number; }
    };
    call: <A extends PM.DropFunctionsContext<Actions<AD, ACA>>, N extends keyof A>(
        name: N,
        options: CallOptions,
        emitters: Emitters | EmittersResolver,
    ) => A[N];
    caller: (
        emiters: Emitters | EmittersResolver,
        defaultOptions?: CallOptions,
    ) => <A extends PM.DropFunctionsContext<Actions<AD, ACA>>, N extends keyof A>(
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

export type CreateServiceOptions<AD extends ApiDefinition<AD>> =
    Readonly<PM.Omit<Required<CreateServiceInput<AD>>, "logger"> & { logger: PM.InternalLogger }>;
