import jsan from "jsan";
import {Observable, Subscription, from, throwError} from "rxjs";
import {serializerr} from "serializerr";

import * as M from "../model";
import * as PM from "../private/model";
import {curryLogger, curryOwnFunctionMembers} from "../private/util";

export function buildProviderMethods<AD extends M.ApiDefinition<AD>>(
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
        const logger: PM.InternalLogger = curryOwnFunctionMembers(
            options.logger
                ? curryLogger(options.logger)
                : serviceOptions.logger,
            "[provider]",
        );

        logger.info(`register()`);

        const subscriptions: Map<PM.PayloadUid, Pick<Subscription, "unsubscribe">> = new Map();
        const listenerSubscriptionArgs: PM.Arguments<typeof eventEmitter.on> = [
            serviceOptions.channel,
            (...listenerArgs) => {
                const resolvedArgs = onEventResolver(...listenerArgs);
                const {payload} = resolvedArgs;
                const {name, uid} = payload;
                const logData = JSON.stringify({name, channel: serviceOptions.channel, payloadType: payload.type, uid});

                // unsubscribe forced on the client side, normally occurring on "finishPromise" resolving
                if (payload.type === "unsubscribe") {
                    const subscription = subscriptions.get(uid);

                    if (!subscription) {
                        logger.debug(`subscription for uid="${uid}" has already been removed`);
                        return;
                    }

                    subscription.unsubscribe();
                    subscriptions.delete(uid);

                    logger.debug(`unsubscribe`, logData);
                    logger.debug(`subscription removed, subscriptions count: ${subscriptions.size}`, logData);
                }

                if (payload.type !== "request") {
                    return;
                }

                const action = actions[name];
                const actionCtx: M.ActionContext<typeof listenerArgs> = {args: listenerArgs};

                // TODO TS: get rid of typecasting
                type ActionOutput = Extract<PM.ResponsePayload<AD>, { data: PM.Any }>["data"];
                const actionResult = (action as PM.Any).apply(actionCtx, payload.args) as Observable<ActionOutput> | Promise<ActionOutput>;

                const handlers = (() => {
                    const emit = (() => {
                        const {emitter} = resolvedArgs || {emitter: eventEmitter};
                        return (data: PM.ResponsePayload<AD>) => {
                            emitter.emit(serviceOptions.channel, data);
                        };
                    })();
                    const unsubscribe = () => {
                        logger.debug(`unsubscribe triggered by client signal`, logData);

                        setTimeout(() => {
                            const subscription = subscriptions.get(uid);

                            if (!subscription) {
                                logger.debug(`subscription has not been resolved`, logData);
                                return;
                            }

                            subscription.unsubscribe();
                            subscriptions.delete(uid);

                            logger.debug(`subscription removed, subscriptions count: ${subscriptions.size}`, logData);
                        }, 0);
                    };
                    const baseResponse: Readonly<Pick<PM.ResponsePayload<AD>, "uid" | "name" | "type">> = {type: "response", uid, name};

                    return {
                        next(value: ActionOutput) {
                            const responseData = payload.serialization === "jsan"
                                ? jsan.stringify(value, null, null, {refs: true})
                                : value;
                            emit({...baseResponse, data: responseData as typeof value});
                            logger.debug(`notification.emit`, logData);
                        },
                        error(error: Error) {
                            emit({...baseResponse, error: serializerr(error)});
                            unsubscribe();
                            logger.error(`notification.error`, error, logData);
                        },
                        complete() {
                            emit({...baseResponse, complete: true});
                            unsubscribe();
                            logger.debug(`notification.complete`, logData);
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

                logger.debug(`subscription added, subscriptions count: ${subscriptions.size}`, logData);
            },
        ];

        eventEmitter.on(...listenerSubscriptionArgs);

        logger.info(`registered`, JSON.stringify({actionsKeys: Object.keys(actions)}));

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
