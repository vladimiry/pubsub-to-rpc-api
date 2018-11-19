import jsan from "jsan";
import deserializeError from "deserialize-error";
import uuid from "uuid-browser";
import {Observable, Subscriber, Subscription} from "rxjs";
import {serializerr} from "serializerr";

import * as Model from "./model";

const ONE_SECOND_MS = 1000;
// tslint:disable-next-line:no-empty
const emptyFunction: Model.LoggerFn = () => {};
const stubLogger = {
    info: emptyFunction,
    error: emptyFunction,
};

class Service<Actions extends Model.ActionsRecord<Extract<keyof Actions, string>>> {
    private static readonly registerStat: Record<string, { channel: string; index: number; listenersCount: number }> = {};
    private readonly options: { channel: string; callTimeoutMs: number; logger: Model.Logger };

    constructor(opts: { channel: string; defaultCallTimeoutMs?: number; logger?: Model.Logger }) {
        this.options = {
            channel: opts.channel,
            callTimeoutMs: typeof opts.defaultCallTimeoutMs !== "undefined" ? opts.defaultCallTimeoutMs : ONE_SECOND_MS * 3,
            logger: opts.logger ? opts.logger : stubLogger,
        };
    }

    public register<ActionName extends keyof Actions>(
        actions: Actions,
        em: Model.CombinedEventEmitter,
        config: {
            requestResolver?: Model.RequestResolver;
            logger?: Model.Logger;
        } = {},
    ): () => void {
        const logger = config.logger || this.options.logger;
        const {channel} = this.options;
        const stat: typeof Service.registerStat[typeof channel] = Service.registerStat[channel]
            = (Service.registerStat[channel] || {channel, index: 0, listenersCount: 0});
        const index = stat.index++;
        const subscriptions: Subscription[] = [];
        const arrayOfEvenNameAndHandler = [
            channel,
            (...args: Model.TODO[]) => {
                const resolvedArgs = config.requestResolver ? config.requestResolver(...args) : false;
                const payload: Model.RequestPayload<ActionName> | Model.ResponsePayload<ActionName, Model.TODO> = resolvedArgs
                    ? resolvedArgs.payload
                    : args[0];

                if (payload.type !== "request") {
                    return;
                }

                const {name, uid} = payload;
                const ctx: Model.ActionContext<typeof args> = {[Model.ACTION_CONTEXT_SYMBOL]: {args}};
                const action = actions[name];
                const actionResult: ReturnType<typeof action> = "data" in payload
                    ? (action as Model.Action).call(ctx, payload.data)
                    : (action as Model.ActionWithoutInput).call(ctx);

                type Output = Model.UnpackedActionResult<typeof actionResult>;
                type ActualResponsePayload = Model.ResponsePayload<typeof name, Output>;

                const emitter = resolvedArgs
                    ? resolvedArgs.emitter
                    : em;
                const response: ActualResponsePayload = {uid, name, type: "response"};
                const subscription: Subscription = actionResult.subscribe(
                    (value) => {
                        const responseData = payload.serialization === "jsan" ? jsan.stringify(value) : value;
                        const output: ActualResponsePayload = {...response, data: responseData};
                        emitter.emit(channel, output);
                        logger.info(`emitted.data: ${JSON.stringify({index})}`);
                    },
                    (error) => {
                        const output: ActualResponsePayload = {...response, error: serializerr(error)};
                        emitter.emit(channel, output);
                        logger.error(`emitted.error: ${JSON.stringify({index})}`, error);
                        setTimeout(() => unsubscribe, 0);
                    },
                    () => {
                        const output: ActualResponsePayload = {...response, complete: true};
                        emitter.emit(channel, output);
                        logger.info(`emitted.complete: ${JSON.stringify({index})}`);
                        setTimeout(() => unsubscribe, 0);
                    }, // TODO emit "complete" event to close observable on client side
                );
                const unsubscribe = () => {
                    subscription.unsubscribe();
                    subscriptions.splice(subscriptions.indexOf(subscription), 1);
                    logger.info(`subscription removed: ${JSON.stringify({subscriptionsCount: subscriptions.length, index})}`);
                };

                subscriptions.push(subscription);
                logger.info(`subscription added: ${JSON.stringify({subscriptionsCount: subscriptions.length, index})}`);
            },
        ];

        em.on.apply(em, arrayOfEvenNameAndHandler);
        stat.listenersCount++;

        logger.info(`registered: ${JSON.stringify({actionsKeys: Object.keys(actions), index, stat})}`);

        return () => {
            em.off.apply(em, arrayOfEvenNameAndHandler);
            subscriptions.forEach((subscription) => subscription.unsubscribe());
            logger.info(`unregistered: ${JSON.stringify({index, stat})}`);
        };
    }

    // TODO track function parameter extracting issue https://github.com/Microsoft/TypeScript/issues/24068
    public call<ActionName extends keyof Actions>(
        name: ActionName,
        {listenChannel, timeoutMs, finishPromise, notificationWrapper, serialization}: Model.CallOptions,
        emitters: Model.Emitters | Model.EmittersResolver,
    ): Actions[ActionName] {
        const runNotification = notificationWrapper || ((fn) => fn()) as (fn: (...args: Model.TODO[]) => void) => void;
        const {channel} = this.options;

        // tslint:disable:only-arrow-functions
        return function(data) {
            const requestData = arguments.length ? {data} : {};
            const request: Model.RequestPayload<ActionName> = {
                uid: uuid.v4(),
                type: "request",
                serialization,
                name,
                ...requestData,
            };

            type Return = ReturnType<Actions[ActionName]>;

            return Observable.create((observer: Subscriber<Return>) => {
                const {emitter, listener} = typeof emitters === "function" ? emitters() : emitters;
                const subscribeChannel = listenChannel || channel;
                const timeoutId = setTimeout(
                    () => {
                        release();
                        const error = new Error(`Invocation timeout of "${name}" method on "${channel}" channel`);
                        runNotification(() => observer.error(error));
                    },
                    timeoutMs,
                );
                const release = () => {
                    clearTimeout(timeoutId);
                    listener.off.apply(listener, arrayOfEvenNameAndHander);
                };
                const emitError = (error: Error) => {
                    release();
                    runNotification(() => observer.error(deserializeError(error)));
                };
                const emitComplete = () => {
                    release();
                    runNotification(() => observer.complete());
                };
                const arrayOfEvenNameAndHander = [
                    subscribeChannel,
                    (payload: Model.ResponsePayload<ActionName, Return> | Model.RequestPayload<ActionName>) => {
                        if (payload.type !== "response" || payload.uid !== request.uid) {
                            return;
                        }
                        if ("error" in payload) {
                            emitError(deserializeError(payload.error));
                            return;
                        }
                        if ("data" in payload) {
                            clearTimeout(timeoutId);
                            const responseData = serialization === "jsan" ? jsan.parse(payload.data) : payload.data;
                            runNotification(() => observer.next(responseData));
                        }
                        if ("complete" in payload && payload.complete) {
                            emitComplete();
                        }
                    },
                ];

                if (finishPromise) {
                    finishPromise
                        .then(emitComplete)
                        .catch(emitError);
                }

                listener.on.apply(listener, arrayOfEvenNameAndHander);
                emitter.emit(channel, request);
            });
        };
    }

    public caller(
        emiters: Model.Emitters | Model.EmittersResolver,
        defaultOptions: Model.CallOptions = {timeoutMs: this.options.callTimeoutMs},
    ) {
        return <ActionName extends keyof Actions>(name: ActionName, options: Model.CallOptions = defaultOptions) => this.call(
            name,
            {...defaultOptions, ...options},
            emiters,
        );
    }
}

export {
    Model,
    Service,
};
