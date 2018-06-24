import deserializeError from "deserialize-error";
import uuid from "uuid-browser";
import {Observable, Subscriber, Subscription} from "rxjs";
import {serializerr} from "serializerr";

import * as Model from "./model";

export {
    Model,
    Service,
};

class Service<Actions extends Model.ActionsRecord<Extract<keyof Actions, string>>> {
    public unregister?: () => void;

    constructor(private readonly options: { channel: string }) {}

    public register<ActionName extends keyof Actions>(
        actions: Actions,
        em: Model.CombinedEventEmitter,
        {requestResolver}: { requestResolver?: Model.RequestResolver } = {},
    ): void {
        if (this.unregister) {
            this.unregister();
        }

        const {channel} = this.options;
        const subscriptions: Subscription[] = [];
        const handler = (...args: Model.AnyType[]) => {
            const resolvedArgs = requestResolver ? requestResolver(...args) : false;
            const payload: Model.RequestPayload<ActionName> | Model.ResponsePayload<ActionName, Model.AnyType> = resolvedArgs
                ? resolvedArgs.payload
                : args[0];

            if (payload.type !== "request") {
                return;
            }

            const {name, data, uid} = payload;
            const action: Model.Action | Model.ActionWithoutInput = actions[name];
            const actionResult = action(data);

            type Output = Model.UnpackedActionResult<typeof actionResult>;
            type ActualResponsePayload = Model.ResponsePayload<typeof name, Output>;

            const emitter = resolvedArgs
                ? resolvedArgs.emitter
                : em;
            const response: ActualResponsePayload = {uid, name, type: "response"};
            const subscription: Subscription = actionResult.subscribe(
                (responseData) => {
                    const output: ActualResponsePayload = {...response, data: responseData};
                    emitter.emit(channel, output);
                },
                (error) => {
                    setTimeout(() => subscription.unsubscribe(), 0);
                    const output: ActualResponsePayload = {...response, error: serializerr(error)};
                    emitter.emit(channel, output);
                },
                () => {
                    setTimeout(() => subscription.unsubscribe(), 0);
                    const output: ActualResponsePayload = {...response, complete: true};
                    emitter.emit(channel, output);
                }, // TODO emit "complete" event to close observable on client side
            );

            subscriptions.push(subscription);
        };

        em.on(channel, handler);

        this.unregister = () => {
            delete this.unregister;
            em.off(channel, handler);
            subscriptions.forEach((subscription) => subscription.unsubscribe());
        };
    }

    // TODO track function parameter extracting issue https://github.com/Microsoft/TypeScript/issues/24068
    public call<ActionName extends keyof Actions>(
        name: ActionName,
        {listenChannel, timeoutMs, unSubscribeOn, notificationWrapper}: Model.CallOptions,
        emitters: Model.Emitters | Model.EmittersResolver,
    ): Actions[ActionName] {
        const runNotification = notificationWrapper || ((fn) => fn()) as (fn: (...args: Model.AnyType[]) => void) => void;
        const {channel} = this.options;

        // tslint:disable:only-arrow-functions
        return function(data) {
            const requestData = arguments.length ? {data} : {};
            const request: Model.RequestPayload<ActionName> = {uid: uuid.v4(), type: "request", name, ...requestData};
            type Return = ReturnType<Actions[ActionName]>;

            return Observable.create((observer: Subscriber<Return>) => {
                const subscribeChannel = listenChannel || channel;
                const {emitter, listener} = typeof emitters === "function"
                    ? emitters()
                    : emitters;
                const handler = (payload: Model.ResponsePayload<ActionName, Return> | Model.RequestPayload<ActionName>) => {
                    if (payload.type !== "response" || payload.uid !== request.uid) {
                        return;
                    }

                    if ("error" in payload) {
                        clear();
                        runNotification(() => observer.error(deserializeError(payload.error)));
                        return;
                    }

                    if ("data" in payload) {
                        runNotification(() => observer.next(payload.data));
                    }

                    if ("complete" in payload && payload.complete) {
                        clear();
                        runNotification(() => observer.complete());
                    }
                };
                const clear = () => {
                    clearTimeout(timeoutHandle);
                    listener.off(subscribeChannel, handler);
                };
                let timeoutHandle: NodeJS.Timer;

                if (unSubscribeOn) {
                    unSubscribeOn.then(() => {
                        clear();
                        observer.complete();
                    });
                }

                if (timeoutMs) {
                    timeoutHandle = setTimeout(
                        () => {
                            clear();
                            const error = new Error(`Invocation timeout of "${name}" method on "${channel}" channel`);
                            observer.error(error);
                        },
                        timeoutMs,
                    );
                }

                listener.on(subscribeChannel, handler);
                emitter.emit(channel, request);
            });
        };
    }

    public caller(emiters: Model.Emitters | Model.EmittersResolver, topOptions: Model.CallOptions = {}) {
        return <ActionName extends keyof Actions>(name: ActionName, options: Model.CallOptions = {}) => this.call(
            name,
            {...topOptions, ...options},
            emiters,
        );
    }
}
