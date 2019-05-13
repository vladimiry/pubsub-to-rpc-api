import deserializeError from "deserialize-error";
import jsan from "jsan";
import uuid from "uuid-browser";
import {Observable, Subscriber, Subscription, from, throwError} from "rxjs";
import {serializerr} from "serializerr";

import * as M from "./model";
import * as PM from "./private/model";
import {curryLogger} from "./private/util";

export function createService<AD extends M.ApiDefinition<AD>>(
    {
        channel,
        apiDefinition,
        callTimeoutMs = PM.ONE_SECOND_MS * 3,
        logger: _logger_ = PM.LOG_STUB, // tslint:disable-line:variable-name
    }: M.CreateServiceInput<AD>,
): M.CreateServiceReturn<AD> {
    const logger = curryLogger(_logger_);

    logger.info("createService()");

    const serviceOptions: M.CreateServiceOptions<AD> = {channel, apiDefinition, callTimeoutMs, logger};
    const providerMethods = buildProviderMethods<AD>(serviceOptions);
    const clientMethods = buildClientMethods<AD>(serviceOptions);

    return {
        ...providerMethods,
        ...clientMethods,
    };
}

function buildProviderMethods<AD extends M.ApiDefinition<AD>>(
    serviceOptions: M.CreateServiceOptions<AD>,
): Pick<M.CreateServiceReturn<AD>, "register"> {
    const register: ReturnType<typeof buildProviderMethods>["register"] = (
        actions,
        eventEmitter,
        options = {},
    ) => {
        const {
            onEventResolver = ((...listenerArgs) => {
                return {
                    payload: listenerArgs[PM.ON_EVENT_LISTENER_DEFAULT_PAYLOAD_ARG_INDEX],
                    emitter: eventEmitter,
                };
            }) as M.ProviderOnEventResolver,
        } = options;
        const logger = options.logger
            ? curryLogger(options.logger)
            : serviceOptions.logger;

        logger.info(`register()`);

        const subscriptions: Map<PM.PayloadUid, Pick<Subscription, "unsubscribe">> = new Map();
        const listenerSubscriptionArgs: PM.Arguments<typeof eventEmitter.on> = [
            serviceOptions.channel,
            (...listenerArgs) => {
                const resolvedArgs = onEventResolver(...listenerArgs);
                const {payload} = resolvedArgs;
                const {name, uid} = payload;
                const logData = JSON.stringify({channel: serviceOptions.channel, name, type: payload.type, uid});

                // unsubscribe forced on the client side, normally occurring on "finishPromise" resolving
                if (payload.type === "unsubscribe") {
                    const subscription = subscriptions.get(uid);

                    if (!subscription) {
                        logger.warn(`failed to resolve subscription by uid: ${uid}`);
                        return;
                    }

                    subscription.unsubscribe();
                    subscriptions.delete(uid);

                    logger.debug(`provider.unsubscribe: ${logData}`);
                    logger.debug(`subscription removed: ${logData}, subscriptions count: ${subscriptions.size}`);
                }

                if (payload.type !== "request") {
                    return;
                }

                const ctx: M.ActionContext<typeof listenerArgs> = {[M.ACTION_CONTEXT_SYMBOL]: {args: listenerArgs}};
                const action = actions[name];

                // TODO TS: get rid of typecasting
                type ActionOutput = Extract<PM.ResponsePayload<AD>, { data: PM.Any }>["data"];
                const actionResult = (action as PM.Any).apply(ctx, payload.args) as Observable<ActionOutput> | Promise<ActionOutput>;

                const handlers = (() => {
                    const emit = (() => {
                        const {emitter} = resolvedArgs || {emitter: eventEmitter};
                        return (data: PM.ResponsePayload<AD>) => emitter.emit(serviceOptions.channel, data);
                    })();
                    const unsubscribe = () => {
                        logger.debug(`triggered unsubscribing: ${logData}`);

                        setTimeout(() => {
                            const subscription = subscriptions.get(uid);

                            if (!subscription) {
                                logger.debug(`subscription has not been resolved: ${logData}`);
                                return;
                            }

                            subscription.unsubscribe();
                            subscriptions.delete(uid);

                            logger.debug(`subscription removed: ${logData}, subscriptions count: ${subscriptions.size}`);
                        }, 0);
                    };
                    const baseResponse: Readonly<Pick<PM.ResponsePayload<AD>, "uid" | "name" | "type">> = {type: "response", uid, name};

                    return {
                        next(value: ActionOutput) {
                            const responseData = payload.serialization === "jsan"
                                ? jsan.stringify(value, null, null, {refs: true})
                                : value;

                            emit({...baseResponse, data: responseData as typeof value});

                            logger.debug(`provider.emit: ${logData}`);
                        },
                        error(error: Error) {
                            emit({...baseResponse, error: serializerr(error)});
                            unsubscribe();

                            logger.error(`provider.error: ${logData}`, error);
                        },
                        complete() {
                            emit({...baseResponse, complete: true});
                            unsubscribe();

                            logger.debug(`provider.complete: ${logData}`);
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

                logger.debug(`subscription added: ${logData}, subscriptions count: ${subscriptions.size}`);
            },
        ];

        eventEmitter.on(...listenerSubscriptionArgs);

        logger.info(`registered: ${JSON.stringify({actionsKeys: Object.keys(actions)})}`);

        return {
            deregister() {
                eventEmitter.removeListener(...listenerSubscriptionArgs);
                subscriptions.forEach((subscription) => subscription.unsubscribe());
                subscriptions.clear();
                logger.info(`"unregister" called`);
            },
            resourcesStat() {
                return {subscriptionsCount: subscriptions.size};
            },
        };
    };

    return {
        register,
    };
}

function buildClientMethods<AD extends M.ApiDefinition<AD>>(
    serviceOptions: M.CreateServiceOptions<AD>,
): Pick<M.CreateServiceReturn<AD>, "call" | "caller"> {
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
            notificationWrapper: runNotification = PM.DEFAULT_NOTIFICATION_WRAPPER,
            serialization,
            onEventResolver = onEventResolverDefault,
        },
        emitters,
    ) => {
        type Action = M.Actions<AD>[keyof M.Actions<AD>]; // TODO TS: use "M.Actions<AD>[typeof name]"
        type ActionOutput = PM.Unpacked<ReturnType<Action>>;

        return ((...actionArgs: PM.Arguments<Action>) => {
            const observable$: Observable<ActionOutput> = new Observable((observer: Subscriber<ActionOutput>) => {
                const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
                const request: Readonly<PM.RequestPayload<AD>> = {
                    uid: uuid.v4(),
                    type: "request",
                    serialization,
                    name: name as unknown as keyof M.Actions<AD>, // TODO TS: get rid of typecasting
                    args: actionArgs,
                };
                const timeoutId = setTimeout(
                    () => {
                        signals.error(
                            serializerr(
                                new Error(
                                    `Invocation timeout of "${name}" method on "${emitChannel}" channel with ${timeoutMs}ms timeout`,
                                ),
                            ),
                        );
                        emitter.emit(emitChannel, {uid: request.uid, type: "unsubscribe"}); // send unsubscribe signal to api provider
                    },
                    timeoutMs,
                );
                const releaseTimeout = () => {
                    clearTimeout(timeoutId);
                };
                const release = () => {
                    releaseTimeout();
                    listener.removeListener(...listenerSubscriptionArgs);
                };
                const signals = {
                    error(e: ReturnType<typeof serializerr>) {
                        release();
                        runNotification(() => observer.error(deserializeError(e)));
                    },
                    next(data: ActionOutput) {
                        releaseTimeout();
                        runNotification(() => {
                            observer.next(
                                serialization === "jsan"
                                    ? jsan.parse(data as unknown as string)
                                    : data,
                            );
                        });
                    },
                    complete() {
                        release();
                        runNotification(() => observer.complete());
                    },
                } as const;
                const listenerSubscriptionArgs: Readonly<PM.Arguments<typeof listener.on & typeof listener.removeListener>> = [
                    listenChannel,
                    (...listenerArgs) => {
                        const {payload} = onEventResolver(...listenerArgs);

                        if (payload.type !== "response" || payload.uid !== request.uid) {
                            return;
                        }
                        if ("error" in payload) {
                            signals.error(deserializeError(payload.error));
                            return;
                        }
                        if ("data" in payload) {
                            signals.next(payload.data);
                        }
                        if ("complete" in payload && payload.complete) {
                            signals.complete();
                        }
                    },
                ];

                if (finishPromise) {
                    finishPromise
                        .then(() => {
                            signals.complete();
                            emitter.emit(emitChannel, {uid: request.uid, type: "unsubscribe"}); // send unsubscribe signal to api provider
                        })
                        .catch(signals.error);
                }

                // TODO consider enabling internal listeners Map-based cache
                listener.on(...listenerSubscriptionArgs);

                emitter.emit(emitChannel, request);
            });

            // TODO TS: get rid of typecasting
            // TODO TS: value should be automatically inferred as "promise" | "observable"
            const apiActionType = serviceOptions.apiDefinition[name as unknown as keyof M.Actions<AD>];

            if (apiActionType === "promise") {
                return observable$.toPromise();
            }

            return observable$;
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
