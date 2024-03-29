import {ActionType, createService, subscribableLikeToObservable} from "lib";
import {bufferCount, delay, map, take} from "rxjs/operators";
import {EventEmitter} from "events";
import {from, interval, lastValueFrom, merge, of, throwError} from "rxjs";
import * as PM from "lib/private/model";
import rewiremock from "rewiremock";
import sinon from "sinon";
import test from "ava";
import UUID from "pure-uuid";

// TODO extend test cases:
//      - a whole emitter/listener.on/off/emit cycle of provider and client
//      - multiple registered api sets on the single service
//      - custom "onEventResolver"
//      - etc

test.serial("calling 3 methods", async (t) => {
    const apiDefinition = {
        method1: ActionType.Promise<{ input1: string }, { output1: number }>(),
        method2: ActionType.Observable<number, { output2: number }>(),
        method3: ActionType.SubscribableLike<number, { output3: number }>(),
    };
    const channel = randomStr();
    const service = createService({channel, apiDefinition});
    const providerEmitters = {emitter: new EventEmitter(), listener: new EventEmitter()};
    const clientEmitters = {emitter: providerEmitters.listener, listener: providerEmitters.emitter};
    const method1Input = {input1: randomStr()};
    const method1Expected = {output1: Number(method1Input.input1)};
    const method2Input = 123;
    const method2ExpectedItems = [0, 1, 2].map((i) => ({output2: method2Input * i}));
    const method3Input = 345;
    const method3ExpectedItems = [0, 1, 2].map((i) => ({output3: method3Input * i}));
    const clientEmitterSpy = sinon.spy(clientEmitters.emitter, "emit");
    const providerEmitterSpy = sinon.spy(providerEmitters.emitter, "emit");
    const client = service.caller(clientEmitters);

    service.register(
        {
            method1: async () => method1Expected,
            method2: (val) => interval(150).pipe(
                take(3),
                map((v) => ({output2: val * v})),
            ),
            method3: (val) => {
                const observable$ = interval(250).pipe(
                    take(3),
                    map((v) => ({output3: val * v})),
                );
                return {
                    subscribeLike: observable$.subscribe.bind(observable$),
                };
            },
        },
        providerEmitters.listener,
        {
            onEventResolver: (payload) => {
                return {payload, emitter: providerEmitters.emitter};
            },
        },
    );

    await lastValueFrom(
        merge(
            from(client("method1")(method1Input)),
            client("method2")(method2Input),
            subscribableLikeToObservable(
                client("method3")(method3Input),
            ),
        ),
    );

    t.true(clientEmitterSpy.calledWithExactly(
        channel,
        sinon.match((request: PM.PayloadRequest<typeof apiDefinition>) => {
            const uid = Boolean(request.uid.length);
            const type = request.type === "request";
            const name = request.name === "method1" || request.name === "method2"
            const data = "args" in request
                ? (
                    (request.name === "method1" && request.args[0] === method1Input)
                    ||
                    (request.name === "method2" && request.args[0] === method2Input)
                    ||
                    (request.name === "method3" && request.args[0] === method3Input)
                )
                : false;

            return uid && type && name && data;
        }, "request"),
    ));

    t.true(providerEmitterSpy.calledWithExactly(
        channel,
        sinon.match((response: PM.PayloadResponse<typeof apiDefinition>) => {
            const uid = Boolean(response.uid.length);
            const type = response.type === "response";
            const data = "data" in response
                &&
                (
                    response.data === method1Expected
                    ||
                    response.data === method2ExpectedItems as PM.Any
                    ||
                    response.data === method3ExpectedItems as PM.Any
                );

            return uid && type && data;
        }, "request"),
    ));
});

test.serial("backend error", async (t) => {
    const service = createService({
        channel: "channel-345",
        apiDefinition: {
            method: ActionType.Observable<string, number>(),
        },
    });
    const emitter = new EventEmitter();

    service.register(
        {
            method: (input) => isNaN(Number(input))
                ? throwError(() => new Error(`"${input}" can't be parsed to number`))
                : of(Number(input)),
        },
        emitter,
    );

    await t.throwsAsync(
        lastValueFrom(
            service.call(
                "method",
                {timeoutMs: 500},
                {emitter, listener: emitter},
            )("w-456"),
        ),
        {message: `"w-456" can't be parsed to number`},
    );
});

test.serial("timeout error", async (t) => {
    const emitter = new EventEmitter();
    const inputValue = 123;
    const timeoutMs = 500;
    const delayMs = timeoutMs * 1.5;
    const methodObservable = "numberToStringObservable";
    const methodPromise = "numberToStringPromise";
    const channel = randomStr();
    const service = createService({
        channel,
        apiDefinition: {
            [methodObservable]: ActionType.Observable<number, string>(),
            [methodPromise]: ActionType.Promise<number, string>(),
        },
    });
    const client = service.caller({emitter, listener: emitter}, {timeoutMs});
    const actions: Parameters<typeof service.register>[0] = {
        [methodObservable]: (arg1) => of(String(arg1)).pipe(delay(delayMs)),
        [methodPromise]: async (arg1) => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return String(arg1);
        },
    };

    service.register(actions, emitter);

    await Promise.all([
        await t.throwsAsync(
            lastValueFrom(
                client(methodObservable)(inputValue),
            ),
            {message: `Invocation timeout of calling "${methodObservable}" method on "${channel}" channel with ${timeoutMs}ms timeout`},
        ),
        await t.throwsAsync(
            client(methodPromise)(inputValue),
            {message: `Invocation timeout of calling "${methodPromise}" method on "${channel}" channel with ${timeoutMs}ms timeout`},
        ),
    ]);

    const [res1, res2] = await Promise.all([
        await lastValueFrom(
            client(methodObservable, {timeoutMs: delayMs * 1.2})(inputValue),
        ),
        await client(methodPromise, {timeoutMs: delayMs * 1.2})(inputValue),
    ]);
    t.is(String(inputValue), res1);
    t.is(String(inputValue), res2);
});

test.serial("zero timeout", async (t) => {
    const emitter = new EventEmitter();
    const mockedRxjs = {timer: sinon.spy((await import("rxjs")).timer)} as PM.Any;
    const {createService: createServiceMocked} = await rewiremock.around(
        () => import("lib"),
        (mock) => mock(() => import("rxjs")).callThrough().with(mockedRxjs),
    );
    const service = createServiceMocked({channel: "123", apiDefinition: {"method": ActionType.Promise<number, string>()}});
    service.register({method: async (value) => String(value)}, emitter);
    const client = service.caller({emitter, listener: emitter});
    await client("method", {timeoutMs: 111})(123);
    await client("method", {timeoutMs: 0})(123);
    await client("method", {timeoutMs: 0})(123);
    t.true(mockedRxjs.timer.calledWithExactly(111));
    t.is(mockedRxjs.timer.callCount, 1);
});

test.serial("calling method without arguments", async (t) => {
    const apiDefinition = {
        methodObservable: ActionType.Observable/* default generics values: <[] , void> */(),
        methodPromise: ActionType.Promise/* default generics values: <[] , void> */(),
    };
    const channel = randomStr();
    const service = createService({channel, apiDefinition});
    const em = new EventEmitter();
    const emitSpy = sinon.spy(em, "emit");

    service.register(
        {
            methodObservable: () => of(void 0),
            methodPromise: async () => {}, // tslint:disable-line:no-empty
        },
        em,
    );
    await lastValueFrom(
        service.call("methodObservable", {timeoutMs: 500}, {listener: em, emitter: em})(),
    );

    t.true(emitSpy.calledWithExactly(
        channel,
        sinon.match(
            (request: PM.PayloadRequest<typeof apiDefinition>) => {
                return request.type === "request" && !request.args.length;
            },
            `request should have empty "args" array`,
        ),
    ));
});

test.serial("stream", async (t) => {
    const channel = randomStr();
    const service = createService({
        channel,
        apiDefinition: {
            stream: ActionType.Observable<{ start: number, count: number, delayMs: number }, number>(),
        },
    });
    const em = new EventEmitter();

    service.register({
            stream(input) {
                return interval(input.delayMs).pipe(
                    take(input.count),
                    map((value) => input.start + value),
                );
            },
        },
        em,
    );
    const start = 10;
    const count = 5;
    const delayMs = 250;
    const streamMethod = service.call("stream", {timeoutMs: delayMs * count * 1.3}, {listener: em, emitter: em});
    const actual = await lastValueFrom(
        streamMethod({start, count, delayMs})
            .pipe(bufferCount(count)),
    );
    const expected = new Array(count).fill(0).map((...[, i]) => start + i);
    t.deepEqual(expected, actual);
});

test.serial("preserve references (jsan)", async (t) => {
    const {parse, stringify} = await import("jsan");
    const mockedJsan = {
        parse: sinon.spy(parse),
        stringify: sinon.spy(stringify),
    };
    const {createService: createServiceMocked} = await rewiremock.around(
        () => import("lib"),
        (mock) => {
            mock(() => import("jsan")).callThrough().with(mockedJsan);
        },
    );

    interface O1 {
        n: number;
        o: { s: string };
    }

    interface Output {
        o1: O1;
        o1_list: O1[];
    }

    const apiDefinition = {
        method: ActionType.Observable<boolean, Output>(),
    };
    const channel = randomStr();
    const service = createServiceMocked({channel, apiDefinition});
    const em = new EventEmitter();
    const emOpts = {listener: em, emitter: em};
    const structureCloningCaller = service.caller(emOpts, {timeoutMs: 500, serialization: "jsan"});
    const expectedDataO1 = {n: 123, o: {s: "345"}};
    const expectedData = {o1: expectedDataO1, o1_list: [expectedDataO1, expectedDataO1, expectedDataO1]};
    // tslint:disable-next-line:max-line-length
    const expectedJsanStr = `{"o1":{"n":${expectedDataO1.n},"o":{"s":"${expectedDataO1.o.s}"}},"o1_list":[{"$jsan":"$.o1"},{"$jsan":"$.o1"},{"$jsan":"$.o1"}]}`;

    service.register({
        method: (clone) => {
            return of(
                clone
                    ? JSON.parse(JSON.stringify(expectedData))
                    : expectedData,
            );
        },
    }, em);

    t.is(0, mockedJsan.parse.callCount);
    t.is(0, mockedJsan.stringify.callCount);
    const noStructureCloningCalledData = await lastValueFrom(
        service.call("method", {timeoutMs: 100}, emOpts)(true),
    );
    t.is(0, mockedJsan.parse.callCount);
    t.is(0, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, noStructureCloningCalledData);
    for (const o1 of noStructureCloningCalledData.o1_list) {
        t.false(noStructureCloningCalledData.o1 === o1);
    }

    const calledWithCallerData = await lastValueFrom(
        structureCloningCaller("method")(false),
    );
    t.is(1, mockedJsan.parse.callCount);
    t.is(1, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, calledWithCallerData);
    for (const o1 of calledWithCallerData.o1_list) {
        t.true(calledWithCallerData.o1 === o1);
    }

    const directMethodCalledData = await lastValueFrom(
        service.call("method", {timeoutMs: 100, serialization: "jsan"}, emOpts)(false),
    );
    t.is(2, mockedJsan.parse.callCount);
    t.is(2, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, directMethodCalledData);
    for (const o1 of directMethodCalledData.o1_list) {
        t.true(directMethodCalledData.o1 === o1);
    }

    t.true(mockedJsan.stringify.alwaysCalledWithExactly(expectedData, undefined, undefined, {refs: true}));
    t.true(mockedJsan.parse.alwaysCalledWithExactly(expectedJsanStr));
});

test.serial("preserve references (msgpackr)", async (t) => {
    interface O1 {
        n: number;
        o: { s: string };
    }

    interface Output {
        o1: O1;
        o1_list: O1[];
    }

    const apiDefinition = {
        method: ActionType.Observable<boolean, Output>(),
    };
    const channel = randomStr();
    const service = createService({channel, apiDefinition});
    const em = new EventEmitter();
    const emOpts = {listener: em, emitter: em};
    const structureCloningCaller = service.caller(emOpts, {timeoutMs: 500, serialization: "msgpackr"});
    const expectedDataO1 = {n: 123, o: {s: "345"}};
    const expectedData = {o1: expectedDataO1, o1_list: [expectedDataO1, expectedDataO1, expectedDataO1]};

    service.register({
        method: (clone) => {
            return of(
                clone
                    ? JSON.parse(JSON.stringify(expectedData))
                    : expectedData,
            );
        },
    }, em);

    const noStructureCloningCalledData = await lastValueFrom(
        service.call("method", {timeoutMs: 100}, emOpts)(true),
    );
    t.deepEqual(expectedData, noStructureCloningCalledData);
    for (const o1 of noStructureCloningCalledData.o1_list) {
        t.false(noStructureCloningCalledData.o1 === o1);
    }

    const calledWithCallerData = await lastValueFrom(
        structureCloningCaller("method")(false),
    );
    t.deepEqual(expectedData, calledWithCallerData);
    for (const o1 of calledWithCallerData.o1_list) {
        t.true(calledWithCallerData.o1 === o1);
    }

    const directMethodCalledData = await lastValueFrom(
        service.call("method", {timeoutMs: 100, serialization: "msgpackr"}, emOpts)(false),
    );
    t.deepEqual(expectedData, directMethodCalledData);
    for (const o1 of directMethodCalledData.o1_list) {
        t.true(directMethodCalledData.o1 === o1);
    }
});

function randomStr(): string {
    return new UUID(4).format();
}
