import {Observable} from "rxjs";

import * as M from "../model";

export type Any = any; // tslint:disable-line:no-any

export type ActionsDefinition<T> = {
    [K in keyof T]: <R extends Any>(...args: Any[]) => ReturnTypeWrapper<"promise" | "observable", R>
};

export type Actions<T> = {
    [K in Extract<keyof T, string>]: T[K] extends (...args: infer A) => ReturnTypeWrapper<infer RT, infer R>
        ? (RT extends "promise" ? (/*this: M.ActionContext,*/ ...args: A) => Promise<R> :
            RT extends "observable" ? (/*this: M.ActionContext,*/ ...args: A) => Observable<R> :
                never)
        : never;
};

export type PayloadUid = string;

export type RequestPayload<AD extends ActionsDefinition<AD>, A extends Actions<AD> = Actions<AD>> =
    |
    ({
        type: "request";
        uid: PayloadUid;
        name: keyof A;
        args: Arguments<A[keyof A]>;
    } & Pick<M.CallOptions, "serialization">)
    |
    {
        type: "unsubscribe";
        uid: PayloadUid;
        name: keyof A;
    };

export type ResponsePayload<AD extends ActionsDefinition<AD>, A extends Actions<AD> = Actions<AD>> =
    {
        type: "response";
        uid: PayloadUid;
        name: keyof A;
    } & (
    | { data: Unpacked<ReturnType<A[keyof A]>> }
    | { complete: boolean }
    | { error: Any }
    );

export type Payload<AD extends ActionsDefinition<AD>> = RequestPayload<AD> | ResponsePayload<AD>;

export class ReturnTypeWrapper<T extends "promise" | "observable", R> {
    constructor(public readonly type: T) {}
}

export type Arguments<F extends (...x: Any[]) => Any> =
    F extends (...args: infer A) => Any ? A : never;

export type Unpacked<T> =
    T extends Promise<infer U2> ? U2 :
        T extends Observable<infer U3> ? U3 :
            T;

export type NeverIfEmpty<T> = keyof T extends never ? never : T;

export const MODULE_NAME_PREFIX = "[pubsub-to-stream-api]";

export const ONE_SECOND_MS = 1000;

export const ACTION_CONTEXT_SYMBOL = Symbol(`${MODULE_NAME_PREFIX}:ACTION_CONTEXT_SYMBOL`);

export const EMPTY_FN: M.LoggerFn = () => {}; // tslint:disable-line:no-empty

export const LOG_STUB: Record<keyof M.Logger, M.LoggerFn> = Object.freeze({
    error: EMPTY_FN,
    warn: EMPTY_FN,
    info: EMPTY_FN,
    verbose: EMPTY_FN,
    debug: EMPTY_FN,
});

export const DEFAULT_NOTIFICATION_WRAPPER: Required<M.CallOptions>["notificationWrapper"] = (fn) => fn();
