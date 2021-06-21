import {Observable, Subscribable} from "rxjs";

import * as PM from "./private/model";

// don't extend/expose NodeJS.EventEmitter
export interface EventListener {
    on: (event: string, listener: (...args: PM.Any[]) => void) => this;
    removeListener: (event: string, listener: (...args: PM.Any[]) => void) => this;
}

// don't extend/expose NodeJS.EventEmitter
export interface EventEmitter {
    emit(event: string, ...args: PM.Any[]): void | boolean;
}

export type CombinedEventEmitter = EventListener & EventEmitter;

export interface Emitters {
    emitter: EventEmitter;
    listener: EventListener;
}

export type EmittersResolver = () => Emitters;

export type ProviderOnEventResolver<AD extends ApiDefinition<AD>, ACA extends PM.DefACA = PM.DefACA> = (
    ...args: ACA
) => {
    payload: PM.Payload<AD>;
    emitter: EventEmitter;
};

export type ClientOnEventResolver<AD extends ApiDefinition<AD>, ACA extends PM.DefACA = PM.DefACA> = (
    ...args: ACA
) => {
    payload: PM.Payload<AD>;
};

export interface CallOptions<AD extends ApiDefinition<AD>, ACA extends PM.DefACA = PM.DefACA> {
    timeoutMs: number;
    finishPromise?: Promise<PM.Any>;
    listenChannel?: string;
    notificationWrapper?: <R extends PM.Any>(fn: (...args: PM.Any[]) => R) => R;
    serialization?: "jsan" | "msgpackr";
    onEventResolver?: ClientOnEventResolver<AD, ACA>;
    logger?: Logger;
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
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT> | SubscribableLike<infer OUT>
            ? IN
            : never
    };
    ApiImplReturns: {
        [K in keyof API]: API[K] extends (...args: infer IN) => Observable<infer OUT> | Promise<infer OUT> | SubscribableLike<infer OUT>
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
    API extends Parameters<I[RN]>[0] = Parameters<I[RN]>[0]> = ScanResult<API>;

export type ActionContext<ACA extends PM.DefACA = PM.DefACA> = Readonly<{ args: Readonly<ACA> }>;

type ActionTypeString<T extends "promise" | "observable" | "subscribableLike", IN extends PM.Any = void, OUT extends PM.Any = void> =
    T
    &
    {
        in: IN;
        out: OUT;
        outType: T,
    };

// TODO use "export type SubscribableLike<T> = Subscribable<T>" so "rxjs.from(subscribable)" call just works
// it's currently impossible to use "rxjs.from(subscribable)" call since it will throw error
// because rxjs checks specific Symbol to present in "subscribable", see https://github.com/ReactiveX/rxjs/issues/4532
export type SubscribableLike<T> = PM.NoExtraProperties<{
    subscribeLike: Subscribable<T>["subscribe"];
}>

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
    SubscribableLike: <IN extends PM.Any = void, OUT extends PM.Any = void>() => {
        const result = "subscribableLike";
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

export type Actions<AD extends ApiDefinition<AD>, ACA extends PM.DefACA | void = void> = {
    [K in Extract<keyof AD, string>]: AD[K] extends ActionTypeString<infer OUT_WRAP, infer IN, infer OUT>
        ? OUT_WRAP extends "promise"
            ? (this: void | (ACA extends PM.DefACA ? ActionContext<ACA> : void), arg: IN) => Promise<OUT>
            : OUT_WRAP extends "observable"
                ? (this: void | (ACA extends PM.DefACA ? ActionContext<ACA> : void), arg: IN) => Observable<OUT>
                : OUT_WRAP extends "subscribableLike"
                    ? (this: void | (ACA extends PM.DefACA ? ActionContext<ACA> : void), arg: IN) => SubscribableLike<OUT>
                    : never
        : never;
};

export interface CreateServiceRegisterOptions<AD extends ApiDefinition<AD>, ACA extends PM.DefACA | void = void> {
    onEventResolver?: ProviderOnEventResolver<AD, Exclude<ACA, void>>;
    logger?: Logger;
}

export interface CreateServiceReturn<AD extends ApiDefinition<AD>, ACA extends PM.DefACA | void = void> {
    register: <A extends Actions<AD, ACA>>(
        actions: A,
        eventEmitter: CombinedEventEmitter,
        options?: CreateServiceRegisterOptions<AD, ACA>,
    ) => {
        deregister: () => void;
        resourcesStat: () => { subscriptionsCount: number; }
    };
    call: <A extends PM.DropFunctionsContext<Actions<AD, ACA>>, N extends keyof A = keyof A>(
        name: N,
        options: CallOptions<AD, Exclude<ACA, void>>,
        emitters: Emitters | EmittersResolver,
    ) => A[N];
    caller: (
        emitters: Emitters | EmittersResolver,
        defaultOptions?: CallOptions<AD, Exclude<ACA, void>>,
    ) => <A extends PM.DropFunctionsContext<Actions<AD, ACA>>, N extends keyof A = keyof A>(
        name: N,
        options?: CallOptions<AD, Exclude<ACA, void>>,
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
