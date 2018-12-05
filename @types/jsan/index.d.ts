declare module "jsan" {
    // tslint:disable-next-line:no-any
    const stringify: (value: any, replacer: null, spacer: null, optins: { refs: boolean }) => string;
    const parse: typeof JSON.parse;
}
