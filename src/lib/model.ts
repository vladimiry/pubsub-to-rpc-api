import * as PM from "./private/model";
import {createService} from "./index";

export type EventListener = Pick<NodeJS.EventEmitter, "on" | "off">;

export type EventEmitter = Pick<NodeJS.EventEmitter, "emit">;

export type CombinedEventEmitter = EventListener & EventEmitter;

export interface Emitters {
    emitter: EventEmitter;
    listener: EventListener;
}

export type EmittersResolver = () => Emitters;

export type RequestResolver = (/* "on" listener args: */ ...args: PM.Arguments<PM.Arguments<Pick<EventListener, "on">["on"]>[1]>) => {
    payload: PM.Any;
    emitter: EventEmitter;
};

export interface CallOptions {
    timeoutMs: number;
    finishPromise?: Promise<PM.Any>;
    listenChannel?: string;
    notificationWrapper?: (fn: (...args: PM.Any[]) => PM.Any) => PM.Any;
    serialization?: "jsan";
}

export type LoggerFn = (...args: PM.Any[]) => void;

export interface Logger {
    error: LoggerFn;
    warn: LoggerFn;
    info: LoggerFn;
    verbose: LoggerFn;
    debug: LoggerFn;
}

export interface ActionContext<Args extends PM.Any[] = PM.Any[]> {
    [PM.ACTION_CONTEXT_SYMBOL]: Readonly<{ args: Readonly<Args> }>;
}

export interface ScanServiceTypes<Instance extends ReturnType<typeof createService>,
    Api extends PM.Arguments<Instance["register"]>[0] = PM.Arguments<Instance["register"]>[0]> {
    Api: Api;
    UnpackedApi: { [K in keyof Api]: Api[K] };
}

// tslint:disable-next-line:variable-name
export const ActionReturnType = Object.freeze({
    Promise: <T>() => new PM.ReturnTypeWrapper<"promise", PM.NeverIfEmpty<T>>("promise"),
    Observable: <T>() => new PM.ReturnTypeWrapper<"observable", PM.NeverIfEmpty<T>>("observable"),
});
