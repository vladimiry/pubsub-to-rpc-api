import * as M from "./../model";
import * as PM from "./model";

export function curryOwnFunctionMembers<T extends PM.Any>(src: T, ...args: PM.Any[]): T {
    const dest: T = typeof src === "function" ? src.bind(undefined) : Object.create(null);

    for (const key of Object.getOwnPropertyNames(src)) {
        const srcMember = src[key];

        if (typeof srcMember === "function") {
            dest[key] = srcMember.bind(src, ...args);
        }
    }

    return dest;
}

export function curryLogger(logger: M.Logger): typeof logger {
    return curryOwnFunctionMembers(logger, PM.MODULE_NAME_PREFIX);
}
