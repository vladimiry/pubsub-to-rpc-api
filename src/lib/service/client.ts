import deserializeError from "deserialize-error";
import jsan from "jsan";
import uuid from "uuid-browser";
import {NEVER, Observable, from, race, throwError, timer} from "rxjs";
import {filter, finalize, map, mergeMap, takeUntil, takeWhile} from "rxjs/operators";

import * as M from "../model";
import * as PM from "../private/model";
import {addEventListener} from "./client-observables-cache";
import {curryOwnFunctionMembers} from "../private/util";

export function buildClientMethods<AD extends M.ApiDefinition<AD>>(
    serviceOptions: M.CreateServiceOptions<AD>,
): Pick<M.CreateServiceReturn<AD>, "call" | "caller"> {
    const logger = curryOwnFunctionMembers(serviceOptions.logger || PM.LOG_STUB, "[client]");
    const emitChannel = serviceOptions.channel;
    const onEventResolverDefault: M.ClientOnEventResolver = (...listenerArgs) => {
        return {
            payload: listenerArgs[PM.ON_EVENT_LISTENER_DEFAULT_PAYLOAD_ARG_INDEX],
        };
    };
    const call: ReturnType<typeof buildClientMethods>["call"] = (
        name,
        {
            timeoutMs,
            finishPromise,
            listenChannel = emitChannel,
            notificationWrapper = PM.NOTIFICATION_WRAPPER_STUB,
            serialization,
            onEventResolver = onEventResolverDefault,
        },
        emitters,
    ) => {
        type Action = M.Actions<AD>[keyof M.Actions<AD>]; // TODO TS: use "M.Actions<AD>[typeof name]"
        type ActionOutput = PM.Unpacked<ReturnType<Action>>;

        return ((...actionArgs: PM.Arguments<Action>) => {
            const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
            const request: Readonly<PM.RequestPayload<AD>> = {
                uid: uuid.v4(),
                type: "request",
                serialization,
                name: name as unknown as keyof M.Actions<AD>, // TODO TS: get rid of typecasting
                args: actionArgs,
            } as const;
            const emitUnsubscribeSignalToProvider = (source: "finish promise" | "timeout") => {
                emitter.emit(emitChannel, {type: "unsubscribe", uid: request.uid});
                logger.debug(`sent "unsubscribe" signal to provider, source: "${source}"`);
            };
            const observableBundle = addEventListener(listener, listenChannel, {logger, notificationWrapper});
            const result$: Observable<ActionOutput> = race(
                timer(timeoutMs).pipe(
                    mergeMap(() => {
                        emitUnsubscribeSignalToProvider("timeout");
                        return throwError(
                            new Error(
                                `Invocation timeout of calling "${name}" method on "${emitChannel}" channel with ${timeoutMs}ms timeout`,
                            ),
                        );
                    }),
                ),
                observableBundle.observable$.pipe(
                    map(({listenerArgs}) => onEventResolver(...listenerArgs).payload as PM.Payload<AD>),
                    filter(({uid, type}) => uid === request.uid && type === "response"),
                    map((payload) => payload as PM.ResponsePayload<AD>),
                    takeWhile((payload) => !("complete" in payload && payload.complete)),
                    mergeMap((payload) => {
                        if ("data" in payload) {
                            return [
                                serialization === "jsan"
                                    ? jsan.parse(payload.data as unknown as string)
                                    : payload.data,
                            ];
                        }
                        if ("error" in payload) {
                            return throwError(deserializeError(payload.error));
                        }
                        return [void 0]; // "payload.data" is "undefined" ("void" action response type)
                    }),
                ),
            ).pipe(
                takeUntil(
                    finishPromise
                        ?
                        from(finishPromise).pipe(
                            finalize(() => emitUnsubscribeSignalToProvider("finish promise")),
                        )
                        :
                        NEVER,
                ),
                finalize(() => {
                    observableBundle.removeEventListener();
                    notificationWrapper(PM.EMPTY_FN);
                }),
            );

            setTimeout(() => {
                emitter.emit(emitChannel, request);
            }, 0);

            // TODO TS: get rid of typecasting
            // TODO TS: value should be automatically inferred as "promise" | "observable"
            const apiActionType = serviceOptions.apiDefinition[name as unknown as keyof M.Actions<AD>];

            return apiActionType === "promise"
                ? result$.toPromise()
                : result$;
        }) as PM.Any; // TODO TS: get rid of typecasting
    };
    const caller: ReturnType<typeof buildClientMethods>["caller"] = (
        emitters,
        defaultOptions = {timeoutMs: serviceOptions.callTimeoutMs},
    ) => {
        const emittersLessCall = (name: keyof M.Actions<AD>, options: M.CallOptions = defaultOptions) => {
            return call(
                name,
                {...defaultOptions, ...options},
                emitters,
            );
        };
        return emittersLessCall as PM.Any; // TODO TS: get rid of typecasting
    };

    return {
        call,
        caller,
    };
}
