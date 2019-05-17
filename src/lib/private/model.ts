import {Observable} from "rxjs";

import * as M from "../model";

export type Any = any; // tslint:disable-line:no-any

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export type Arguments<F extends (...x: Any[]) => Any> =
    F extends (...args: infer A) => Any ? A : never;

export type Unpacked<T> =
    T extends Promise<infer U2> ? U2 :
        T extends Observable<infer U3> ? U3 :
            T;
export type DropFunctionsContext<T> = {
    [K in keyof T]: T[K] extends (this: infer THIS, ...args: infer A) => infer R
        ? (this: void, ...args: A) => R
        : never;
};

export type PayloadUid = string;

export type RequestPayload<AD extends M.ApiDefinition<AD>, A extends M.Actions<AD> = M.Actions<AD>> =
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

export type ResponsePayload<AD extends M.ApiDefinition<AD>, A extends M.Actions<AD> = M.Actions<AD>> =
    {
        type: "response";
        uid: PayloadUid;
        name: keyof A;
    } & (
    | { data: Unpacked<ReturnType<A[keyof A]>> }
    | { complete: boolean }
    | { error: Any }
    );

export type Payload<AD extends M.ApiDefinition<AD>> = RequestPayload<AD> | ResponsePayload<AD>;

export const MODULE_NAME = "pubsub-to-rpc-api";

export const ONE_SECOND_MS = 1000;

export const EMPTY_FN: M.LoggerFn = () => {}; // tslint:disable-line:no-empty

export type InternalLogger = M.Logger & { _private: true };

export const LOG_STUB: Readonly<InternalLogger> = {
    _private: true,
    error: EMPTY_FN,
    warn: EMPTY_FN,
    info: EMPTY_FN,
    verbose: EMPTY_FN,
    debug: EMPTY_FN,
};

export const NOTIFICATION_WRAPPER_STUB: Required<M.CallOptions>["notificationWrapper"] = (fn) => fn();

// NodeJS.EventEmitter.on listener function doesn't get "event" as the first argument but gets only payload args
// so we go the similar way expecting by default that payload is the first argument as we need only payload
// if payload is not the first argument for used event emitter
// then "onEventResolver" should be defined, like Electron.js case: "event" is the first argument and data args go next
// WARN: changing this constant would be a breaking change: will force change of all custom "onEventResolver" functions
export const ON_EVENT_LISTENER_DEFAULT_PAYLOAD_ARG_INDEX = 0;
