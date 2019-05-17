import {Observable, Subject} from "rxjs";

import * as M from "../model";
import * as PM from "../private/model";
import {curryOwnFunctionMembers} from "../private/util";

type Channel = string;

type Listener = PM.Arguments<M.EventListener["on"] & M.EventListener["removeListener"]>[1];

interface ObservableValue {
    listenerArgs: PM.Arguments<Listener>;
}

const resultBundlePrivateProp = Symbol(`[${PM.MODULE_NAME}] "ResultBundle" private property symbol`);

interface ResultBundle {
    observable$: Observable<ObservableValue>;
    removeEventListener: () => void;
    [resultBundlePrivateProp]: {
        cached: Date;
        lastAccessed: Date;
        count: number;
    };
}

type PerChannelResultBundles = Map<Channel, ResultBundle>;

// TODO enable lazy initialization
const perEntityManagerCache: WeakMap<M.EventListener, PerChannelResultBundles> = new WeakMap();

export function addEventListener<AD extends M.ApiDefinition<AD>>(
    eventListener: M.EventListener,
    channel: Channel,
    options: {
        logger: M.CreateServiceOptions<AD>["logger"],
        notificationWrapper: Required<M.CallOptions>["notificationWrapper"];
    },
): Readonly<ResultBundle> {
    const logger = curryOwnFunctionMembers(options.logger, "addEventListener()");
    const {notificationWrapper} = options;
    const bundles: PerChannelResultBundles = (
        perEntityManagerCache.get(eventListener)
        ||
        (() => {
            const map = new Map();
            perEntityManagerCache.set(eventListener, map);
            return map;
        })()
    );
    const exitingBundle = bundles.get(channel);

    if (exitingBundle) {
        exitingBundle[resultBundlePrivateProp].count++;
        exitingBundle[resultBundlePrivateProp].lastAccessed = new Date();

        logger.debug("[cache]", "item reused", JSON.stringify(resolveCacheStat(eventListener, channel)));

        return exitingBundle;
    }

    const subject$ = new Subject<ObservableValue>();
    const subscriptionArgs: Readonly<[Channel, Listener]> = [
        channel,
        (...listenerArgs) => {
            notificationWrapper(() => {
                subject$.next({listenerArgs});
            });
        },
    ];
    // TODO test "removeEventListener" called API method call completed (errored / succeeded)
    const removeEventListener = () => {
        const privateProp = newBundle[resultBundlePrivateProp];

        privateProp.count--;

        if (!privateProp.count) {
            eventListener.removeListener(...subscriptionArgs);
            logger.debug("[cache]", "item removed", JSON.stringify(resolveCacheStat(eventListener, channel)));

            bundles.delete(channel);
            logger.debug("[cache]", "item removed", JSON.stringify(resolveCacheStat(eventListener, channel)));

            if (!bundles.size) {
                perEntityManagerCache.delete(eventListener);
                logger.debug("[cache]", "root cache removed", JSON.stringify(resolveCacheStat(eventListener, channel)));
            }
        }
    };
    const newBundleDate = new Date();
    const newBundle = {
        observable$: subject$.asObservable(),
        removeEventListener,
        [resultBundlePrivateProp]: {
            cached: newBundleDate,
            lastAccessed: newBundleDate,
            count: 1,
        },
    };

    bundles.set(channel, newBundle);

    eventListener.on(...subscriptionArgs);

    logger.debug("[cache]", "item added", JSON.stringify(resolveCacheStat(eventListener, channel)));

    return newBundle;
}

function resolveCacheStat(
    eventListener: M.EventListener,
    channel: Channel,
): {
    channel: Channel,
    totalCachedItemsPerEventListener: number;
    cached: Date | null;
    lastAccessed: Date | null;

} {
    const bundles = perEntityManagerCache.get(eventListener);
    const stats: ReturnType<typeof resolveCacheStat> = {
        channel,
        totalCachedItemsPerEventListener: 0,
        cached: null,
        lastAccessed: null,
    };

    if (!bundles) {
        return stats;
    }

    stats.totalCachedItemsPerEventListener = bundles.size;

    const bundle = bundles.get(channel);

    if (bundle) {
        stats.cached = bundle[resultBundlePrivateProp].cached;
        stats.lastAccessed = bundle[resultBundlePrivateProp].lastAccessed;
    }

    return stats;
}
