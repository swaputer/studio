async function unavailable(): Promise<never> {
  throw new Error("TinySol project imports require the Node.js compiler or CLI.");
}

export const readFile = unavailable;
export const realpath = unavailable;
