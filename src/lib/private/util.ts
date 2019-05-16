import * as M from "./../model";
import * as PM from "./model";

export function curryOwnFunctionMembers<T extends object | ((...a: PM.Any[]) => PM.Any)>(
    src: T,
    ...args: PM.Any[]
): T {
    const dest: T = typeof src === "function"
        ? src.bind(undefined) :
        Object.create(null);

    for (const key of Object.getOwnPropertyNames(src)) {
        const srcMember = (src as PM.Any)[key];

        if (typeof srcMember === "function") {
            (dest as PM.Any)[key] = srcMember.bind(src, ...args);
        }
    }

    return dest;
}

export function curryLogger<T extends { _private: true }>(logger: M.Logger): typeof logger & T {
    return curryOwnFunctionMembers(logger, `[${PM.MODULE_NAME}]`) as PM.Any; // TODO get rid of typecasting
}
