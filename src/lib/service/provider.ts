import {from, Observable, Subscription, throwError} from "rxjs";
import jsan from "jsan";
import {Packr} from "msgpackr";
import {serializeError} from "serialize-error";

import {curryLogger, curryOwnFunctionMembers} from "../private/util";
import * as M from "../model";
import * as PM from "../private/model";

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
            const listenerSubscriptionArgs: Readonly<Parameters<typeof eventEmitter.on>> = [
                serviceOptions.channel,
                (...listenerArgs) => {
                    const resolvedArgs = onEventResolver(...(listenerArgs as Exclude<ACA, void>));
                    const {payload} = resolvedArgs;
                    const {name, uid} = payload;
                    // WARN don't put "payload.args" into "baseLogData" as it might contain sensitive/large/circular data
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
                    //  - no need to specify "Observable | Promise | SubscribableLike" type explicitly
                    const actionResult:
                        | Observable<ActionUnpackedOutput>
                        | Promise<ActionUnpackedOutput>
                        | M.SubscribableLike<ActionUnpackedOutput>
                        = (action as PM.Any).apply(actionCtx, payload.args);

                    const handlers = (() => {
                        const emit = (payloadResponse: PM.PayloadResponse<AD>) => {
                            (resolvedArgs?.emitter ?? eventEmitter).emit(serviceOptions.channel, payloadResponse);
                        };
                        const basePayloadResponse: Readonly<Pick<PM.PayloadResponse<AD>, "uid" | "name" | "type">>
                            = {type: "response", uid, name};

                        return {
                            next(value: ActionUnpackedOutput) {
                                logger.debug(`notification.emit`, baseLogData);
                                const {serialization} = payload;
                                const responseData = serialization === "jsan"
                                    ? jsan.stringify(value, undefined, undefined, {refs: true})
                                    : serialization === "msgpackr"
                                        // TODO cache/reuse "msgpackr.Packr" instance
                                        ? new Packr({structuredClone: true}).pack(value)
                                        : value;
                                emit({...basePayloadResponse, data: responseData as typeof value});
                            },
                            error(error: Error) {
                                logger.error(`notification.error`, baseLogData, error);
                                emit({...basePayloadResponse, error: serializeError(error)});
                                unsubscribe();
                            },
                            complete() {
                                logger.debug(`notification.complete`, baseLogData);
                                emit({...basePayloadResponse, complete: true});
                                unsubscribe();
                            },
                        };
                    })();

                    const actionResult$ = ("subscribe" in actionResult)
                        ? actionResult
                        : ("subscribeLike" in actionResult)
                            ? {subscribe: actionResult.subscribeLike.bind(actionResult)}
                            : ("then" in actionResult && "catch" in actionResult)
                                ? from(actionResult)
                                : throwError(() => new Error("Unexpected action result type received"));

                    subscriptions.set(uid, actionResult$.subscribe(handlers));

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
