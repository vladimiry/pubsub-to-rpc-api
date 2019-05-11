import deserializeError from "deserialize-error";
import jsan from "jsan";
import uuid from "uuid-browser";
import {Observable, Subscriber, Subscription, from, throwError} from "rxjs";
import {serializerr} from "serializerr";

import * as M from "./model";
import * as PM from "./private/model";
import {curryLogger} from "./private/util";

export function createService<AD extends PM.ActionsDefinition<AD>>(
    {
        channel,
        actionsDefinition,
        callTimeoutMs = PM.ONE_SECOND_MS * 3,
        logger: _logger_ = PM.LOG_STUB, // tslint:disable-line:variable-name
    }: CreateServiceInput<AD>,
): Readonly<CreateServiceReturn<AD>> {
    const logger = curryLogger(_logger_);

    logger.info("createService()");

    const options: CreateServiceOptions<AD> = Object.freeze({channel, actionsDefinition, callTimeoutMs, logger});
    const providerMethods = buildProviderMethods<AD>(options);
    const clientMethods = buildClientMethods<AD>(options);

    return Object.freeze({
        ...providerMethods,
        ...clientMethods,
    });
}

interface CreateServiceReturn<AD extends PM.ActionsDefinition<AD>> {
    register: <A extends PM.Actions<AD>>(
        actions: A,
        combinerEventEmitter: M.CombinedEventEmitter,
        options?: { requestResolver?: M.RequestResolver; logger?: M.Logger; },
    ) => {
        deregister: () => void;
        resourcesStat: () => { subscriptionsCount: number; }
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
}

interface CreateServiceInput<AD extends PM.ActionsDefinition<AD>> {
    channel: string;
    actionsDefinition: AD;
    callTimeoutMs?: number;
    logger?: M.Logger;
}

type CreateServiceOptions<AD extends PM.ActionsDefinition<AD>> = Readonly<Required<CreateServiceInput<AD>>>;

function buildProviderMethods<AD extends PM.ActionsDefinition<AD>>(
    baseOptions: CreateServiceOptions<AD>,
): Pick<CreateServiceReturn<AD>, "register"> {
    const register: ReturnType<typeof createService>["register"] = (
        actions,
        combinerEventEmitter,
        options = {},
    ) => {
        const {requestResolver} = options;
        const logger = options.logger
            ? curryLogger(options.logger)
            : baseOptions.logger;

        logger.info(`register()`);

        const subscriptions: Map<PM.PayloadUid, Pick<Subscription, "unsubscribe">> = new Map();
        const emOnOffHandlerArgs: PM.Arguments<typeof combinerEventEmitter.on> = [
            baseOptions.channel,
            (...args) => {
                const resolvedArgs = requestResolver && requestResolver(...args) || false;
                const {payload}: { payload: PM.Payload<AD> } = resolvedArgs || {payload: args[0]};
                const {name, uid} = payload;
                const logData = JSON.stringify({channel: baseOptions.channel, name, type: payload.type, uid});

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
                    logger.debug(`subscription removed: ${logData}`);
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
                        const {emitter} = resolvedArgs || {emitter: combinerEventEmitter};
                        return (data: PM.ResponsePayload<AD>) => emitter.emit(baseOptions.channel, data);
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

                            logger.debug(`subscription removed: ${logData}`);
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

        combinerEventEmitter.on(...emOnOffHandlerArgs);

        logger.info(`registered: ${JSON.stringify({actionsKeys: Object.keys(actions)})}`);

        return {
            deregister() {
                combinerEventEmitter.off(...emOnOffHandlerArgs);
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

function buildClientMethods<AD extends PM.ActionsDefinition<AD>>(
    baseOptions: CreateServiceOptions<AD>,
): Pick<CreateServiceReturn<AD>, "call" | "caller"> {
    // TODO provide size/stats getting method
    const byListenerHandlersCache: WeakMap<M.Emitters["listener"], Map<string, ReturnType<typeof byCallUidHandlersMapBuild>>>
        = new WeakMap();

    const call: ReturnType<typeof createService>["call"] = (
        name,
        options,
        emitters,
    ) => {
        type Action = PM.Actions<AD>[keyof PM.Actions<AD>]; // TODO TS: use "PM.Actions<AD>[typeof name]"
        type ActionOutput = PM.Unpacked<ReturnType<Action>>;

        const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
        const emitChannel = baseOptions.channel;
        const listeningChannel = options.listenChannel || emitChannel;
        const runNotification = options.notificationWrapper || PM.DEFAULT_NOTIFICATION_WRAPPER;

        ensureChannelListening(listener, listeningChannel);

        return ((...args: PM.Arguments<Action>) => {
            const request: PM.RequestPayload<AD> = {
                uid: uuid.v4(),
                type: "request",
                serialization: options.serialization,
                name: name as unknown as keyof PM.Actions<AD>, // TODO TS: get rid of typecasting
                args,
            };
            const observable$: Observable<ActionOutput> = new Observable((observer: Subscriber<ActionOutput>) => {
                const byChannelHandlersMap = byListenerHandlersCache.get(listener);
                const byCallUidHandlersMap = byChannelHandlersMap && byChannelHandlersMap.get(listeningChannel);

                if (!byCallUidHandlersMap) { // not supposed to be undefined at this state
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
                byCallUidHandlersMap.set(
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
            if (baseOptions.actionsDefinition[name as unknown as keyof PM.Actions<AD>]().type === "promise") {
                return observable$.toPromise();
            }

            return observable$;
        }) as PM.Any; // TODO TS: get rid of typecasting
    };

    const caller: ReturnType<typeof createService>["caller"] = (
        emiters,
        defaultOptions = {timeoutMs: baseOptions.callTimeoutMs},
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

    return {
        call,
        caller,
    };

    function ensureChannelListening<A extends PM.Actions<AD>, N extends keyof A>(
        listener: M.Emitters["listener"],
        channel: string,
    ) {
        const perChannelCallHandlersCached = (() => {
            const byChannelHandlersMap = byListenerHandlersCache.get(listener);
            return Boolean(byChannelHandlersMap && byChannelHandlersMap.has(channel));
        })();

        if (perChannelCallHandlersCached) {
            return;
        }

        // TODO provide size/stats getting method
        const byCallUidHandlersMap = byCallUidHandlersMapBuild();

        // register single handler per call channel
        listener.on( // TODO implement unsubscribe
            channel,
            (payload: PM.Payload<AD>) => {
                const handler = byCallUidHandlersMap.get(payload.uid);

                if (!handler || payload.type !== "response") {
                    return;
                }
                if ("error" in payload) {
                    handler.error(deserializeError(payload.error));
                    byCallUidHandlersMap.delete(payload.uid);
                    return;
                }
                if ("data" in payload) {
                    handler.next(payload.data);
                }
                if ("complete" in payload && payload.complete) {
                    handler.complete();
                    byCallUidHandlersMap.delete(payload.uid);
                }
            },
        );

        // cache per-channel call handlers
        byListenerHandlersCache.set(
            listener,
            new Map([
                [channel, byCallUidHandlersMap],
            ]),
        );
    }

    function byCallUidHandlersMapBuild<A extends PM.Actions<AD>>()
        : Map<PM.PayloadUid, Pick<Subscriber<PM.Unpacked<ReturnType<A[keyof A]>>>, "next" | "complete" | "error">> {
        return new Map();
    }
}
