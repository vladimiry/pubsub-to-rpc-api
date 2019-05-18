import {Observable, Subject} from "rxjs";

import * as M from "../model";
import * as PM from "../private/model";
import {curryOwnFunctionMembers} from "../private/util";

type Channel = string;

type Listener = PM.Arguments<M.EventListener["on"] & M.EventListener["removeListener"]>[1];

const observableBundleStatsProp = Symbol(`[${PM.MODULE_NAME}] "ObservableBundle" stats property symbol`);

interface ObservableBundle {
    observable$: Observable<{ listenerArgs: PM.Arguments<Listener> }>;
    removeEventListener: () => void;
    [observableBundleStatsProp]: {
        cached: Date;
        lastAccessed: Date;
        count: number;
    };
}

type MappedByChannelObservableBundles = Map<Channel, ObservableBundle>;

// TODO enable lazy initialization
const mappedByChannelObservableBundlesCache: WeakMap<M.EventListener, MappedByChannelObservableBundles> = new WeakMap();

export function addEventListener<AD extends M.ApiDefinition<AD>>(
    eventListener: M.EventListener,
    channel: Channel,
    options: {
        logger: M.CreateServiceOptions<AD>["logger"],
        notificationWrapper: Required<M.CallOptions<AD>>["notificationWrapper"];
    },
): Readonly<ObservableBundle> {
    const logger = curryOwnFunctionMembers(options.logger, "addEventListener()");
    const {notificationWrapper} = options;
    const bundlesMap: MappedByChannelObservableBundles = (
        mappedByChannelObservableBundlesCache.get(eventListener)
        ||
        (() => {
            const map: MappedByChannelObservableBundles = new Map();
            mappedByChannelObservableBundlesCache.set(eventListener, map);
            return map;
        })()
    );
    const existingBundle = bundlesMap.get(channel);

    if (existingBundle) {
        existingBundle[observableBundleStatsProp].count++;
        existingBundle[observableBundleStatsProp].lastAccessed = new Date();

        logger.debug("[cache] reuse event listener", JSON.stringify(resolveCacheStat(eventListener, channel)));

        return existingBundle;
    }

    const subject$ = new Subject<PM.Unpacked<ObservableBundle["observable$"]>>();
    const subscriptionArgs: Readonly<[Channel, Listener]> = [
        channel,
        (...listenerArgs) => {
            notificationWrapper(() => {
                subject$.next({listenerArgs});
            });
        },
    ];
    // TODO test "removeEventListener" called on API method call got finalized (errored / succeeded)
    const removeEventListener = () => {
        const privateProp = newBundle[observableBundleStatsProp];

        privateProp.count--;

        const needToRemoveEventListener = privateProp.count === 0;

        if (!needToRemoveEventListener) {
            return;
        }

        eventListener.removeListener(...subscriptionArgs);
        bundlesMap.delete(channel);
        logger.debug("[cache] remove event listener", JSON.stringify(resolveCacheStat(eventListener, channel)));

        const needToRemoveBundlesMap = bundlesMap.size === 0;

        if (needToRemoveBundlesMap) {
            mappedByChannelObservableBundlesCache.delete(eventListener);
            logger.debug("[cache] remove bundles map as empty", JSON.stringify(resolveCacheStat(eventListener, channel)));
        }
    };
    const newBundleStatsDate = new Date();
    const newBundle: ObservableBundle = {
        observable$: subject$.asObservable(),
        // TODO consider removing event listener with configurable timeout
        //      so the existing listener could be reused by new consumer appeared withing timeout so debounce-like logic
        removeEventListener,
        [observableBundleStatsProp]: {
            cached: newBundleStatsDate,
            lastAccessed: newBundleStatsDate,
            count: 1,
        },
    };

    bundlesMap.set(channel, newBundle);

    eventListener.on(...subscriptionArgs);

    logger.debug("[cache] add event listener", JSON.stringify(resolveCacheStat(eventListener, channel)));

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
    const bundlesMap = mappedByChannelObservableBundlesCache.get(eventListener);
    const stats: ReturnType<typeof resolveCacheStat> = {
        channel,
        totalCachedItemsPerEventListener: 0,
        cached: null,
        lastAccessed: null,
    };

    if (!bundlesMap) {
        return stats;
    }

    stats.totalCachedItemsPerEventListener = bundlesMap.size;

    const bundle = bundlesMap.get(channel);

    if (bundle) {
        stats.cached = bundle[observableBundleStatsProp].cached;
        stats.lastAccessed = bundle[observableBundleStatsProp].lastAccessed;
    }

    return stats;
}
