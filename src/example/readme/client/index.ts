// tslint:disable:no-console

import {API_SERVICE} from "../shared";
import {EM_CLIENT, EM_PROVIDER} from "../shared/event-emitters-mock";

const index = API_SERVICE.caller({emitter: EM_PROVIDER, listener: EM_CLIENT});
const evaluateMathExpressionMethod = index("evaluateMathExpression"/*, {timeoutMs: 600}*/);
const httpPingMethod = index("httpPing"/*, {timeoutMs: 600}*/);

evaluateMathExpressionMethod("32 * 2")
    .then(console.log)
    .catch(console.error);

httpPingMethod({address: "google.com", attempts: 1}, {address: "github.com"}, {address: "1.1.1.1"})
    .subscribe(console.log, console.error);
