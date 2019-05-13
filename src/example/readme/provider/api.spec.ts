import test, {ExecutionContext, ImplementationResult} from "ava";
import {bufferCount} from "rxjs/operators";

import {API} from ".";

const apiActionTests: Record<keyof typeof API, (t: ExecutionContext) => ImplementationResult> = {
    evaluateMathExpression: async (t) => {
        t.is(25, await API.evaluateMathExpression("12 * 2 + 1"));
    },
    httpPing: async (t) => {
        const entries = [
            {address: "google.com", attempts: 1},
            {address: "github.com"},
            {address: "1.1.1.1"},
        ];

        const results = await API
            .httpPing(...entries)
            .pipe(bufferCount(entries.length))
            .toPromise();

        // type checking like assertions implemented below are not really needed since TypeScript handles the type checking

        t.is(results.length, entries.length);

        for (const result of results) {
            if ("time" in result) {
                t.true(typeof result.time === "number");
                t.false("error" in result);
                continue;
            }

            t.true("error" in result && typeof result.error === "string");
        }
    },
};

for (const [apiMethodName, apiMethodTest] of Object.entries(apiActionTests)) {
    test(`API: ${apiMethodName}`, apiMethodTest);
}
