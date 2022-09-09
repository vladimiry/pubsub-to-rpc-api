// @transform-path ./../node_modules/serialize-error/index.js
import {deserializeError} from "serialize-error";
import {filter, finalize, map, mergeMap, takeUntil, takeWhile} from "rxjs/operators";
import {from, lastValueFrom, NEVER, Observable, race, Subject, throwError, timer} from "rxjs";
import jsan from "jsan";
import {Packr} from "msgpackr";
import UUID from "pure-uuid";

import {curryLogger, curryOwnFunctionMembers} from "../private/util";
import * as M from "../model";
import * as PM from "../private/model";

export function observableToSubscribableLike<T>(
    observable: Observable<T>,
): M.SubscribableLike<T> {
    return {
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
}

export function subscribableLikeToObservable<T>(
    subscribableLike: M.SubscribableLike<T>,
): Observable<T> {
    return new Observable<T>((subscriber) => {
        return subscribableLike.subscribeLike({
            next: subscriber.next.bind(subscriber),
            error: subscriber.error.bind(subscriber),
            complete: subscriber.complete.bind(subscriber),
        });
    })
}

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

        return ((...actionArgs: Parameters<Action>) => {
            const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
            const request: Readonly<PM.PayloadRequest<AD>> = {
                uid: new UUID(4).format(),
                type: "request",
                serialization,
                name: name as unknown as keyof M.Actions<AD>, // TODO TS: get rid of typecasting
                args: actionArgs,
            } as const;
            const emitUnsubscribeSignalToProvider = (
                {reason}: Pick<Extract<PM.PayloadRequest<AD>, { type: "unsubscribe-request" }>, "reason">,
            ) => {
                const payload: Extract<PM.PayloadRequest<AD>, { type: "unsubscribe-request" }>
                    = {type: "unsubscribe-request", uid: request.uid, name: request.name, reason};
                emitter.emit(emitChannel, payload);
                logger.debug(`"unsubscribe-request" signal sent to provider, source: "${reason}"`, JSON.stringify(payload));
            };
            const observableBundle = (() => {
                type Listener = Parameters<M.EventListener["on"] & M.EventListener["removeListener"]>[1];
                const subject$ = new Subject<Parameters<Listener>>();
                const subscriptionArgs = [
                    listenChannel,
                    (...listenerArgs: PM.Unpacked<typeof subject$>) => {
                        notificationWrapper(() => subject$.next(listenerArgs));
                    },
                ] as const;
                listener.on(...subscriptionArgs);
                return {
                    observable$: subject$.asObservable(),
                    removeEventListener() {
                        listener.removeListener(...subscriptionArgs);
                        subject$.complete();
                        // subject$.unsubscribe();
                        // (subject$ as unknown) = null;
                        (subscriptionArgs as unknown) = null;
                    },
                } as const;
            })();
            const result$: Observable<ActionOutput> = race(
                timer(timeoutMs).pipe(
                    mergeMap(() => {
                        emitUnsubscribeSignalToProvider({reason: "timeout"});
                        return throwError(() => new Error(
                            `Invocation timeout of calling "${String(name)}" method on "${emitChannel}" channel, ${timeoutMs}ms timeout`,
                        ));
                    }),
                ),
                observableBundle.observable$.pipe(
                    map((listenerArgs) => onEventResolver(...(listenerArgs as Exclude<ACA, void>)).payload),
                    filter(({uid, type}) => uid === request.uid && type === "response"),
                    takeWhile((payload) => !("complete" in payload && payload.complete)),
                    mergeMap((payload) => {
                        if ("data" in payload) {
                            return [
                                serialization === "jsan"
                                    ? jsan.parse(payload.data as unknown as string)
                                    : (
                                        // TODO cache/reuse "msgpackr.Packr" instance
                                        serialization === "msgpackr"
                                            ? new Packr({structuredClone: true}).unpack(payload.data as unknown as Buffer)
                                            : payload.data
                                    ),
                            ];
                        }
                        if ("error" in payload) {
                            return throwError(() => deserializeError(payload.error));
                        }
                        return [void 0]; // "payload.data" is "undefined" ("void" action response type)
                    }),
                ),
            ).pipe(
                takeUntil<PM.Any>(
                    finishPromise
                        ? (
                            from(finishPromise).pipe(
                                finalize(() => emitUnsubscribeSignalToProvider({reason: "finish promise"})),
                            )
                        )
                        : NEVER,
                ),
                finalize(() => {
                    observableBundle.removeEventListener();
                    notificationWrapper(PM.EMPTY_FN);
                }),
            );

            setImmediate(() => emitter.emit(emitChannel, request));

            // TODO TS: get rid of typecasting
            // TODO TS: value should be automatically inferred as "promise" | "observable" | "subscribableLike"
            const apiActionType = serviceOptions.apiDefinition[name as unknown as keyof AD];

            return apiActionType === "promise"
                ? lastValueFrom(result$)
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
