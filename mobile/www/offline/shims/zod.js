// The engine only builds zod schemas for Claude, which isn't used offline.
// Any chain like z.object({...}).describe("...") just returns this stand-in.
const any = new Proxy(function () {}, {
  get: (target, key) => (key === Symbol.toPrimitive || key === "then" ? undefined : any),
  apply: () => any,
});
export const z = any;
export default any;
