import jsan from "jsan";
import {Observable, Subscription, from, throwError} from "rxjs";
import {serializerr} from "serializerr";

import * as M from "../model";
import * as PM from "../private/model";
import {curryLogger, curryOwnFunctionMembers} from "../private/util";

export function buildProviderMethods<AD extends M.ApiDefinition<AD>, ACA extends PM.DefACA | void = void>(
    serviceOptions: M.CreateServiceOptions<AD>,
): Pick<M.CreateServiceReturn<AD, ACA>, "register"> {
    return {
        register(
            actions,
            eventEmitter,
            {
                logger: _logger_, // tslint:disable-line:variable-name
                onEventResolver = (...listenerArgs) => {
                    return {
                        payload: listenerArgs[PM.ON_EVENT_LISTENER_DEFAULT_PAYLOAD_ARG_INDEX],
                        emitter: eventEmitter,
                    };
                },
            }: M.CreateServiceRegisterOptions<AD, ACA> = {},
        ) {
            const logger: PM.InternalLogger = curryOwnFunctionMembers(
                _logger_
                    ? curryLogger(_logger_)
                    : serviceOptions.logger,
                "[provider]",
            );

            logger.info("register()");

            const subscriptions: Map<PM.PayloadUid, Pick<Subscription, "unsubscribe">> = new Map();
            const listenerSubscriptionArgs: Readonly<PM.Arguments<typeof eventEmitter.on>> = [
                serviceOptions.channel,
                (...listenerArgs) => {
                    const resolvedArgs = onEventResolver(...(listenerArgs as Exclude<ACA, void>));
                    const {payload} = resolvedArgs;
                    const {name, uid} = payload;
                    const baseLogData = JSON.stringify({name, channel: serviceOptions.channel, payloadType: payload.type, uid});
                    const unsubscribe = (logDataAppend: string = "") => {
                        const logData = baseLogData + logDataAppend;
                        const subscription = subscriptions.get(uid);

                        if (!subscription) {
                            // logger.debug(`subscription for uid="${uid}" has already been removed`, logData);
                            return;
                        }

                        subscription.unsubscribe();
                        subscriptions.delete(uid);

                        logger.debug(`subscription removed, subscriptions count: ${subscriptions.size}`, logData);
                    };

                    if (payload.type === "unsubscribe-request") {
                        // triggered by client
                        unsubscribe(` ${JSON.stringify({reason: payload.reason})}`);
                        return;
                    }

                    if (payload.type !== "request") {
                        return;
                    }

                    const action = actions[name];
                    const actionCtx: M.ActionContext<typeof listenerArgs> = {args: listenerArgs};

                    type ActionUnpackedOutput = PM.Unpacked<ReturnType<typeof action>>;

                    // TODO TS: get rid of typecasting
                    //  - just "action.apply(actionCtx, payload.args)" should work
                    //  - no need to specify "Observable<ActionUnpackedOutput> | Promise<ActionUnpackedOutput>" type explicitly
                    const actionResult: Observable<ActionUnpackedOutput> | Promise<ActionUnpackedOutput>
                        = (action as PM.Any).apply(actionCtx, payload.args);

                    const handlers = (() => {
                        const emit = (() => {
                            const {emitter} = resolvedArgs || {emitter: eventEmitter};
                            return (payloadResponse: PM.PayloadResponse<AD>) => {
                                emitter.emit(serviceOptions.channel, payloadResponse);
                            };
                        })();
                        const basePayloadResponse: Readonly<Pick<PM.PayloadResponse<AD>, "uid" | "name" | "type">>
                            = {type: "response", uid, name};

                        return {
                            next(value: ActionUnpackedOutput) {
                                const responseData = payload.serialization === "jsan"
                                    ? jsan.stringify(value, null, null, {refs: true})
                                    : value;
                                emit({...basePayloadResponse, data: responseData as typeof value});
                                logger.debug(`notification.emit`, baseLogData);
                            },
                            error(error: Error) {
                                emit({...basePayloadResponse, error: serializerr(error)});
                                unsubscribe();
                                logger.error(`notification.error`, error, baseLogData);
                            },
                            complete() {
                                emit({...basePayloadResponse, complete: true});
                                unsubscribe();
                                logger.debug(`notification.complete`, baseLogData);
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

                    logger.debug(`subscription added, subscriptions count: ${subscriptions.size}`, baseLogData);
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
        },
    };
}
