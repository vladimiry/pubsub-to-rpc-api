import UUID from "pure-uuid";
import deserializeError from "deserialize-error";
import jsan from "jsan";
import {NEVER, Observable, from, race, throwError, timer} from "rxjs";
import {filter, finalize, map, mergeMap, takeUntil, takeWhile} from "rxjs/operators";

import * as M from "../model";
import * as PM from "../private/model";
import {addEventListener} from "./client-observables-cache";
import {curryLogger, curryOwnFunctionMembers} from "../private/util";

export function buildClientMethods<AD extends M.ApiDefinition<AD>, ACA extends PM.DefACA | void = void>(
    serviceOptions: M.CreateServiceOptions<AD>,
): Pick<M.CreateServiceReturn<AD, ACA>, "call" | "caller"> {
    const emitChannel = serviceOptions.channel;
    const call: M.CreateServiceReturn<AD, ACA>["call"] = (
        name,
        {
            timeoutMs,
            finishPromise,
            listenChannel = emitChannel,
            notificationWrapper = PM.NOTIFICATION_WRAPPER_STUB,
            serialization,
            onEventResolver = ((...listenerArgs) => {
                return {
                    payload: listenerArgs[PM.ON_EVENT_LISTENER_DEFAULT_PAYLOAD_ARG_INDEX],
                };
            }) as M.ClientOnEventResolver<AD, Exclude<ACA, void>>,
            logger: _logger_, // tslint:disable-line:variable-name
        },
        emitters,
    ) => {
        const logger: PM.InternalLogger = curryOwnFunctionMembers(
            _logger_
                ? curryLogger(_logger_)
                : serviceOptions.logger,
            "[client]",
        );

        type Action = M.Actions<AD>[keyof M.Actions<AD>]; // TODO TS: use "M.Actions<AD>[typeof name]"
        type ActionOutput = PM.Unpacked<ReturnType<Action>>;

        return ((...actionArgs: PM.Arguments<Action>) => {
            const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
            const request: Readonly<PM.PayloadRequest<AD>> = {
                uid: new UUID(4).format(),
                type: "request",
                serialization,
                name: name as unknown as keyof M.Actions<AD>, // TODO TS: get rid of typecasting
                args: actionArgs,
            } as const;
            const emitUnsubscribeSignalToProvider
                = ({reason}: Pick<Extract<PM.PayloadRequest<AD>, { type: "unsubscribe-request" }>, "reason">) => {
                const payload: Extract<PM.PayloadRequest<AD>, { type: "unsubscribe-request" }>
                    = {type: "unsubscribe-request", uid: request.uid, name: request.name, reason};
                emitter.emit(emitChannel, payload);
                logger.debug(`"unsubscribe-request" signal sent to provider, source: "${reason}"`, JSON.stringify(payload));
            };
            const observableBundle = addEventListener(listener, listenChannel, {logger, notificationWrapper});
            const result$: Observable<ActionOutput> = race(
                timer(timeoutMs).pipe(
                    mergeMap(() => {
                        emitUnsubscribeSignalToProvider({reason: "timeout"});
                        return throwError(
                            new Error(
                                `Invocation timeout of calling "${name}" method on "${emitChannel}" channel with ${timeoutMs}ms timeout`,
                            ),
                        );
                    }),
                ),
                observableBundle.observable$.pipe(
                    map(({listenerArgs}) => {
                        return onEventResolver(...(listenerArgs as Exclude<ACA, void>)).payload;
                    }),
                    filter(({uid, type}) => {
                        return uid === request.uid && type === "response";
                    }),
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
                            finalize(() => emitUnsubscribeSignalToProvider({reason: "finish promise"})),
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
            // TODO TS: value should be automatically inferred as "promise" | "observable" | "subscribableLike"
            const apiActionType = serviceOptions.apiDefinition[name as unknown as keyof M.Actions<AD>];

            return apiActionType === "promise"
                ? result$.toPromise()
                : apiActionType === "subscribableLike"
                    ? observableToSubscribableLike(result$)
                    : result$;
        }) as PM.Any; // TODO TS: get rid of typecasting
    };

    return {
        call,
        caller(
            emitters,
            defaultOptions = {timeoutMs: serviceOptions.callTimeoutMs},
        ) {
            return (name, options = defaultOptions) => call(
                name,
                {...defaultOptions, ...options},
                emitters,
            );
        },
    };
}

export function observableToSubscribableLike<T>(
    observable: Observable<T>,
): M.SubscribableLike<T> {
    const result: M.SubscribableLike<T> = {
        subscribeLike(
            // TODO TS: get rid of typecasting
            ...args: PM.Any[]
        ) {
            const unsubscribable = observable.subscribe(...args);
            return {
                unsubscribe() {
                    return unsubscribable.unsubscribe();
                },
            };
        },
    };
    return result;
}

export function subscribableLikeToObservable<T>(
    subscribableLike: M.SubscribableLike<T>,
): Observable<T> {
    return new Observable<T>((subscriber) => {
        return subscribableLike.subscribeLike(
            (value) => subscriber.next(value),
            (error) => subscriber.error(error),
            () => subscriber.complete(),
        );
    })
}
