import jsan from "jsan";
import deserializeError from "deserialize-error";
import uuid from "uuid-browser";
import {from, Observable, Subscriber, Subscription, throwError} from "rxjs";
import {serializerr} from "serializerr";

import * as M from "./model";
import * as PM from "./private/model";

export {
    M as Model,
    instance,
};

function instance<AD extends PM.ActionsDefinition<AD>>(
    {
        channel,
        actionsDefinition,
        callTimeoutMs = PM.ONE_SECOND_MS * 3,
        logger: instanceLogger = PM.LOG_STUB,
    }: {
        channel: string;
        actionsDefinition: AD,
        callTimeoutMs?: number;
        logger?: M.Logger;
    },
): Readonly<{
    register: <A extends PM.Actions<AD>>(
        actions: A,
        em: M.CombinedEventEmitter,
        options?: { requestResolver?: M.RequestResolver; logger?: M.Logger; },
    ) => {
        deregister: () => void;
        subscriptionStat: () => { size: number; }
    };
    call: <A extends PM.Actions<AD>, N extends keyof A>(
        name: N,
        options: M.CallOptions,
        emitters: M.Emitters | M.EmittersResolver,
    ) => A[N];
    caller: (
        emiters: M.Emitters | M.EmittersResolver,
        defaultOptions?: M.CallOptions,
    ) => <A extends PM.Actions<AD>, N extends keyof A>(
        name: N,
        options?: M.CallOptions,
    ) => A[N];
}> {
    // TODO provide "callsListenersMap" size/stats getting method
    const callsListenersMap: WeakMap<M.Emitters["listener"], Map<string, ReturnType<typeof buildChannelCallsMap>>> = new WeakMap();

    const register: ReturnType<typeof instance>["register"] = (
        actions,
        em,
        options = {},
    ) => {
        const {logger = instanceLogger, requestResolver} = options;

        logger.info(`${PM.LOG_PREFIX} register()`);

        const subscriptions: Map<PM.PayloadUid, Pick<Subscription, "unsubscribe">> = new Map();
        const emOnOffHandlerArgs: PM.Arguments<typeof em.on> = [
            channel,
            (...args) => {
                const resolvedArgs = requestResolver
                    ? requestResolver(...args)
                    : false;
                const payload: PM.Payload<AD> = resolvedArgs
                    ? resolvedArgs.payload
                    : args[0];
                // const resolvedArgs = requestResolver
                //     ? requestResolver(...args)
                //     : false;
                // const {payload}: { payload: PM.Payload<AD> } = resolvedArgs || {payload: args[0]};
                const {name, uid} = payload;
                const logData = JSON.stringify({channel, name, type: payload.type, uid}); // WARN: don't log the actual data

                // unsubscribe forced on the client side, normally occurring on "finishPromise" resolving
                if (payload.type === "unsubscribe") {
                    const subscription = subscriptions.get(uid);

                    if (!subscription) {
                        logger.warn(`${PM.LOG_PREFIX} failed to resolve subscription by uid: ${uid}`);
                        return;
                    }

                    subscription.unsubscribe();
                    subscriptions.delete(uid);

                    logger.debug(
                        `${PM.LOG_PREFIX} provider.unsubscribe: ${logData}`,
                    );
                    logger.debug(
                        `${PM.LOG_PREFIX} subscription removed: ${logData} ${JSON.stringify({subscriptions: subscriptions.size})}`,
                    );
                }

                if (payload.type !== "request") {
                    return;
                }

                const ctx: M.ActionContext<typeof args> = {[PM.ACTION_CONTEXT_SYMBOL]: {args}};
                const action = actions[name];

                // TODO TS: get rid of typecasting
                type ActionOutput = Extract<PM.ResponsePayload<AD>, { data: PM.Any }>["data"];
                const actionResult = (action as PM.Any).apply(ctx, payload.args) as Observable<ActionOutput> | Promise<ActionOutput>;

                const handlers = (() => {
                    const emit = (() => {
                        const {emitter} = resolvedArgs || {emitter: em};
                        return (data: PM.ResponsePayload<AD>) => emitter.emit(channel, data);
                    })();
                    const unsubscribe = () => {
                        logger.debug(`${PM.LOG_PREFIX} triggered unsubscribing: ${logData}`);

                        setTimeout(() => {
                            const subscription = subscriptions.get(uid);

                            if (!subscription) {
                                logger.debug(`${PM.LOG_PREFIX} subscription has not been resolved: ${logData}`);
                                return;
                            }

                            subscription.unsubscribe();
                            subscriptions.delete(uid);

                            logger.debug(
                                `${PM.LOG_PREFIX} subscription removed: ${logData} ${JSON.stringify({subscriptions: subscriptions.size})}`,
                            );
                        }, 0);
                    };
                    const baseResponse: Readonly<Pick<PM.ResponsePayload<AD>, "uid" | "name" | "type">> = {type: "response", uid, name};

                    return {
                        next(value: ActionOutput) {
                            const responseData = payload.serialization === "jsan"
                                ? jsan.stringify(value, null, null, {refs: true})
                                : value;

                            emit({...baseResponse, data: responseData as typeof value});

                            logger.debug(`${PM.LOG_PREFIX} provider.emit: ${logData}`);
                        },
                        error(error: Error) {
                            emit({...baseResponse, error: serializerr(error)});
                            unsubscribe();

                            logger.error(`${PM.LOG_PREFIX} provider.error: ${logData}`, error);
                        },
                        complete() {
                            emit({...baseResponse, complete: true});
                            unsubscribe();

                            logger.debug(`${PM.LOG_PREFIX} provider.complete: ${logData}`);
                        },
                    };
                })();

                const actionResult$ = ("subscribe" in actionResult && "pipe" in actionResult)
                    ? actionResult
                    : ("then" in actionResult && "catch" in actionResult)
                        ? from(actionResult)
                        : throwError(new Error("Unexpected action result type received"));

                subscriptions.set(
                    uid,
                    actionResult$.subscribe(handlers.next, handlers.error, handlers.complete),
                );

                logger.debug(
                    `${PM.LOG_PREFIX} subscription added: ${logData} ${JSON.stringify({subscriptions: subscriptions.size})}`,
                );
            },
        ];

        em.on(...emOnOffHandlerArgs);

        logger.info(`${PM.LOG_PREFIX} registered: ${JSON.stringify({actionsKeys: Object.keys(actions)})}`);

        return {
            deregister() {
                em.off(...emOnOffHandlerArgs);
                subscriptions.forEach((subscription) => subscription.unsubscribe());
                subscriptions.clear();
                logger.info(`${PM.LOG_PREFIX} "unregister" called`);
            },
            subscriptionStat() {
                return {size: subscriptions.size};
            },
        };
    };

    const call: ReturnType<typeof instance>["call"] = (
        name,
        options,
        emitters,
    ) => {
        type Action = PM.Actions<AD>[keyof PM.Actions<AD>]; // TODO TS: use "PM.Actions<AD>[typeof name]"
        type ActionOutput = PM.Unpacked<ReturnType<Action>>;

        const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
        const emitChannel = channel;
        const subscribeChannel = options.listenChannel || emitChannel;
        const runNotification = options.notificationWrapper || PM.DEFAULT_NOTIFICATION_WRAPPER;

        ensureListeningSetup(subscribeChannel, listener);

        return ((...args: PM.Arguments<Action>) => {
            const request: PM.RequestPayload<AD> = {
                uid: uuid.v4(),
                type: "request",
                serialization: options.serialization,
                name: name as unknown as keyof PM.Actions<AD>, // TODO TS: get rid of typecasting
                args,
            };
            const observable$: Observable<ActionOutput> = new Observable((observer: Subscriber<ActionOutput>) => {
                const callsByChannelMap = callsListenersMap.get(listener);
                const callsMap = callsByChannelMap && callsByChannelMap.get(subscribeChannel);

                if (!callsMap) { // not supposed to be undefined at this state
                    runNotification(() => observer.error(new Error(`Failed to resolve "${emitChannel}" channel's calls map`)));
                    return;
                }

                const timeoutId = setTimeout(
                    () => {
                        releaseTimeout();
                        runNotification(() => observer.error(new Error(
                            `Invocation timeout of "${name}" method on "${emitChannel}" channel with ${options.timeoutMs}ms timeout`,
                        )));
                        // sending forced unsubscribe signal to api provider
                        emitter.emit(emitChannel, {uid: request.uid, type: "unsubscribe"});
                    },
                    options.timeoutMs,
                );
                const releaseTimeout = () => {
                    clearTimeout(timeoutId);
                };
                const error = (e: Error) => {
                    releaseTimeout();
                    runNotification(() => observer.error(deserializeError(e)));
                };
                const complete = () => {
                    releaseTimeout();
                    runNotification(() => observer.complete());
                };

                if (options.finishPromise) {
                    options.finishPromise
                        .then(() => {
                            complete();
                            // sending forced unsubscribe signal to api provider
                            emitter.emit(emitChannel, {uid: request.uid, type: "unsubscribe"});
                        })
                        .catch(error);
                }

                // register call handler
                callsMap.set(
                    request.uid,
                    {
                        error,
                        complete,
                        next(data: ActionOutput) {
                            releaseTimeout();
                            runNotification(() => {
                                observer.next(
                                    options.serialization === "jsan"
                                        ? jsan.parse(data as unknown as string)
                                        : data,
                                );
                            });
                        },
                    },
                );

                // execute the call
                emitter.emit(emitChannel, request);
            });

            // TODO TS: get rid of typecasting
            if (actionsDefinition[name as unknown as keyof PM.Actions<AD>]().type === "promise") {
                return observable$.toPromise();
            }

            return observable$;
        }) as PM.Any; // TODO TS: get rid of typecasting
    };

    const caller: ReturnType<typeof instance>["caller"] = (
        emiters,
        defaultOptions = {timeoutMs: callTimeoutMs},
    ) => {
        const emittersLessFn = (name: keyof PM.Actions<AD>, options: M.CallOptions = defaultOptions) => {
            return call(
                name,
                {...defaultOptions, ...options},
                emiters,
            );
        };
        return emittersLessFn as PM.Any; // TODO TS: get rid of typecasting
    };

    return Object.freeze({
        register,
        call,
        caller,
    });

    function buildChannelCallsMap<A extends PM.Actions<AD>>()
        : Map<PM.PayloadUid, Pick<Subscriber<PM.Unpacked<ReturnType<A[keyof A]>>>, "next" | "complete" | "error">> {
        return new Map();
    }

    function ensureListeningSetup<A extends PM.Actions<AD>, N extends keyof A>(
        channel: string, // tslint:disable-line:no-shadowed-variable // intentionally named same as outer-scope "channel" variable
        listener: M.Emitters["listener"],
    ) {
        let callsByChannelMap = callsListenersMap.get(listener);

        if (callsByChannelMap && callsByChannelMap.has(channel)) {
            return;
        }

        const callsMap = buildChannelCallsMap();

        // register single handler per call channel
        listener.on( // TODO implement unsubscribe
            channel,
            (payload: PM.Payload<AD>) => {
                const handler = callsMap.get(payload.uid);

                if (!handler || payload.type !== "response") {
                    return;
                }

                if ("error" in payload) {
                    handler.error(deserializeError(payload.error));
                    callsMap.delete(payload.uid);
                    return;
                }

                if ("data" in payload) {
                    handler.next(payload.data);
                }

                if ("complete" in payload && payload.complete) {
                    handler.complete();
                    callsMap.delete(payload.uid);
                }
            },
        );

        if (!callsByChannelMap) {
            callsByChannelMap = new Map();
            callsListenersMap.set(listener, callsByChannelMap);
        }

        // keep individual calls handlers
        callsByChannelMap.set(channel, callsMap);
    }
}
