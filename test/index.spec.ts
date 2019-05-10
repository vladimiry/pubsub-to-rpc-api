import rewiremock from "rewiremock";
import sinon from "sinon";
import test from "ava";
import uuid from "uuid-browser";
import {delay, map, take} from "rxjs/operators";
import {EMPTY, from, interval, merge, of, throwError} from "rxjs";
import {EventEmitter} from "events";

import {instance, Model} from "../dist/index";
import {Any, RequestPayload, ResponsePayload} from "../dist/private/model";

// TODO test a whole emitter/listener.on/off/emit cycle of provider and client
// TODO test multiple registered api sets on the single service

test("calling 2 methods", async (t) => {
    const API = {
        method1: (arg1: { input1: string; }) => Model.ReturnType.Promise<{ output1: number }>(),
        method2: (arg1: number) => Model.ReturnType.Observable<{ output2: number }>(),
    };
    const channel = randomStr();
    const service = instance({channel, actionsDefinition: API});
    const providerEmitters = {emitter: new EventEmitter(), listener: new EventEmitter()};
    const clientEmitters = {emitter: providerEmitters.listener, listener: providerEmitters.emitter};
    const method1Input = {input1: randomStr()};
    const method1Expected = {output1: Number(method1Input.input1)};
    const method2Input = 123;
    const method2ExpectedItems = [0, 1, 2].map((i) => ({output2: method2Input * i}));
    const clientEmitterSpy = sinon.spy(clientEmitters.emitter, "emit");
    const providerEmitterSpy = sinon.spy(providerEmitters.emitter, "emit");
    const client = service.caller(clientEmitters);

    service.register(
        {
            method1: async (val) => method1Expected,
            method2: (val) => interval(150).pipe(
                take(3),
                map((v) => ({output2: val * v})),
            ),
        },
        providerEmitters.listener,
        {
            requestResolver: (payload) => {
                return {payload, emitter: providerEmitters.emitter};
            },
        },
    );

    await merge(
        from(client("method1")(method1Input)),
        client("method2")(method2Input),
    ).toPromise();

    t.true(clientEmitterSpy.calledWithExactly(
        channel,
        sinon.match((request: RequestPayload<typeof API>) => {
            const uid = Boolean(request.uid.length);
            const type = request.type === "request";
            const name = request.name === "method1" || request.name === "method2";
            const data = "args" in request
                ? (
                    (request.name === "method1" && request.args[0] === method1Input)
                    ||
                    (request.name === "method2" && request.args[0] === method2Input)
                )
                : false;

            return uid && type && name && data;
        }, "request"),
    ));

    t.true(providerEmitterSpy.calledWithExactly(
        channel,
        sinon.match((response: ResponsePayload<typeof API>) => {
            const uid = Boolean(response.uid.length);
            const type = response.type === "response";
            const data = "data" in response && (response.data === method1Expected || response.data === method2ExpectedItems as Any);

            return uid && type && data;
        }, "request"),
    ));
});

test("backend error", async (t) => {
    const service = instance({
        channel: "channel-345",
        actionsDefinition: {
            method: (arg1: string) => Model.ReturnType.Observable<number>(),
        },
    });
    const emitter = new EventEmitter();

    service.register(
        {
            method: (input) => isNaN(Number(input)) ? throwError(new Error(`"${input}" can't be parsed to number`)) : of(Number(input)),
        },
        emitter,
    );

    await t.throwsAsync(service.call(
        "method",
        {timeoutMs: 500},
        {emitter, listener: emitter},
    )("w-456").toPromise(), `"w-456" can't be parsed to number`);
});

test("timeout error", async (t) => {
    const channel = randomStr();
    const service = instance({
        channel,
        actionsDefinition: {
            numberToString: (arg1: number) => Model.ReturnType.Observable<string>(),
        },
    });
    const emitter = new EventEmitter();
    const inputValue = 123;
    const method = "numberToString";
    const timeoutMs = 500;
    const client = service.caller({emitter, listener: emitter}, {timeoutMs});

    service.register({numberToString: (input) => of(String(input)).pipe(delay(1000))}, emitter);

    await t.throwsAsync(
        client(method)(inputValue).toPromise(),
        `Invocation timeout of "${method}" method on "${channel}" channel with ${timeoutMs}ms timeout`,
    );

    t.is(String(inputValue), await client(method, {timeoutMs: 1500})(inputValue).toPromise());
});

test("calling method without input an argument", async (t) => {
    const API = {
        ping: () => Model.ReturnType.Observable<never>(),
    };
    const channel = randomStr();
    const service = instance({channel, actionsDefinition: API});
    const em = new EventEmitter();
    const emitSpy = sinon.spy(em, "emit");

    service.register({ping: () => EMPTY}, em);
    await service.call("ping", {timeoutMs: 500}, {listener: em, emitter: em})().toPromise();

    t.true(emitSpy.calledWithExactly(
        channel,
        sinon.match(
            (request: RequestPayload<typeof API>) => {
                return request.type === "request" && request.args.length === 0;
            },
            "request should have empty \"args\" array",
        ),
    ));
});

test("preserve references", async (t) => {
    const originalJsan = await import("jsan");
    const mockedJsan = {
        parse: sinon.spy(originalJsan, "parse"),
        stringify: sinon.spy(originalJsan, "stringify"),
    };
    const {instance: mockedInstance} = await rewiremock.around(
        () => import("../dist/index"),
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

    const API = {
        method: (arg: boolean) => Model.ReturnType.Observable<Output>(),
    };
    const channel = randomStr();
    const service = mockedInstance({channel, actionsDefinition: API});
    const em = new EventEmitter();
    const emOpts = {listener: em, emitter: em};
    const jsanCaller = service.caller(emOpts, {timeoutMs: 500, serialization: "jsan"});
    const expectedDataO1 = {n: 123, o: {s: "345"}};
    const expectedData = {o1: expectedDataO1, o1_list: [expectedDataO1, expectedDataO1, expectedDataO1]};
    // tslint:disable-next-line:max-line-length
    const expectedJsanStr = `{"o1":{"n":${expectedDataO1.n},"o":{"s":"${expectedDataO1.o.s}"}},"o1_list":[{"$jsan":"$.o1"},{"$jsan":"$.o1"},{"$jsan":"$.o1"}]}`;

    service.register({
        method: (clone) => {
            return of(clone ? JSON.parse(JSON.stringify(expectedData)) : expectedData);
        },
    }, em);

    t.is(0, mockedJsan.parse.callCount);
    t.is(0, mockedJsan.stringify.callCount);
    const noJsanCalledData = await service.call("method", {timeoutMs: 100}, emOpts)(true).toPromise();
    t.is(0, mockedJsan.parse.callCount);
    t.is(0, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, noJsanCalledData);
    for (const o1 of noJsanCalledData.o1_list) {
        t.false(noJsanCalledData.o1 === o1);
    }

    const calledWithCallerData = await jsanCaller("method")(false).toPromise();
    t.is(1, mockedJsan.parse.callCount);
    t.is(1, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, calledWithCallerData);
    for (const o1 of calledWithCallerData.o1_list) {
        t.true(calledWithCallerData.o1 === o1);
    }

    const directMethodCalledData = await service.call("method", {timeoutMs: 100, serialization: "jsan"}, emOpts)(false).toPromise();
    t.is(2, mockedJsan.parse.callCount);
    t.is(2, mockedJsan.stringify.callCount);
    t.deepEqual(expectedData, directMethodCalledData);
    for (const o1 of directMethodCalledData.o1_list) {
        t.true(directMethodCalledData.o1 === o1);
    }

    t.true(mockedJsan.stringify.alwaysCalledWithExactly(expectedData, null, null, {refs: true}));
    t.true(mockedJsan.parse.alwaysCalledWithExactly(expectedJsanStr));
});

function randomStr(): string {
    return uuid.v4();
}
