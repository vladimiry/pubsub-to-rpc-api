import {SERVICE} from "./shared";
import {EM_CLIENT, EM_PROVIDER} from "./event-emitters-mock";

const client = SERVICE.caller({
    emitter: EM_PROVIDER,
    listener: EM_CLIENT,
});

// tslint:disable-next-line:no-console
client("evaluateMathExpression")("32 * 2").subscribe(console.log);

client("httpPing"/*, {timeoutMs: 600}*/)([
    {domain: "https://google.com"},
    {domain: "google.com"},
    {domain: "https://github.com"},
    // tslint:disable-next-line:no-console
]).subscribe(console.log);
