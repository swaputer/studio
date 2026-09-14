function unavailable(): never {
  throw new Error("TinySol project imports require the Node.js compiler or CLI.");
}

export const dirname = unavailable;
export const isAbsolute = unavailable;
export const relative = unavailable;
export const resolve = unavailable;
export const sep = "/";
